//! Deterministic scale qualification for semantic search.
//!
//! The full run is ignored because it is a benchmark, not a correctness test:
//! `cargo test --release semantic_scale_qualification -- --ignored --nocapture`

use super::chunking::{chunk_input, SemanticFacet, SemanticInput};
use crate::history::sha256;
use serde::Serialize;
use serde_json::json;
use std::{collections::HashSet, time::Instant};

const TARGET_CLIPS: usize = 60_000;
const TARGET_VECTOR_DIMENSIONS: usize = 1_024;

#[derive(Debug, Serialize, PartialEq)]
struct CorpusReport {
    clips: usize,
    chunks: usize,
    chunk_p50: usize,
    chunk_p95: usize,
    chunk_p99: usize,
    chunk_max: usize,
    unique_embedding_inputs: usize,
    raw_vector_bytes: u64,
}

fn fixture(index: usize) -> SemanticInput {
    let family = index % 10;
    let (mime, text, facets) = match family {
        0 => ("text/plain", format!("Customer note {index}: call Alice about project cedar.\nFollow up next Tuesday."), vec![]),
        1 => ("text/markdown", format!("# Release {index}\n\n## Changes\n\n- fix search\n- improve startup\n\n```rust\nfn release_{index}() {{}}\n```"), vec![]),
        2 => ("application/json", json!({"id": index, "project": "cedar", "enabled": true}).to_string(), vec![]),
        3 => ("text/csv", format!("name,status,total\norder-{index},paid,42\norder-{},pending,17", index + 1), vec![]),
        4 => ("text/html", format!("<h1>Invoice {index}</h1><p>Paid by Example Ltd.</p><script>ignored()</script>"), vec![]),
        5 => ("text/plain", format!("議事録 {index}\n検索機能とローカル処理について確認しました。"), vec![]),
        6 => ("text/plain", format!("https://example.test/projects/cedar/items/{index}"), vec![]),
        7 => ("text/plain", format!(r"C:\work\cedar\reports\report-{index}.md"), vec![]),
        8 => ("text/plain", "Shared footer: confidential internal document".repeat(12), vec![]),
        _ => (
            "text/plain",
            format!("fn item_{index}() -> usize {{\n    {index}\n}}\n").repeat(40),
            vec![SemanticFacet { id: "core.text.code".into(), payload: json!({"language": "rust"}) }],
        ),
    };
    SemanticInput {
        source_kind: "representation".into(),
        source_id: format!("fixture-{index}"),
        representation_id: Some(format!("representation-{index}")),
        artifact_id: None,
        mime_type: Some(mime.into()),
        format_family: Some("text".into()),
        facets,
        text,
        source_ordinal: 0,
    }
}

fn corpus_report(clips: usize) -> CorpusReport {
    let mut counts = Vec::with_capacity(clips);
    let mut unique = HashSet::new();
    let mut chunks = 0_usize;
    for index in 0..clips {
        let generated = chunk_input(&fixture(index)).expect("qualification fixture must chunk");
        counts.push(generated.len());
        chunks += generated.len();
        unique.extend(
            generated
                .into_iter()
                .map(|chunk| sha256(chunk.embedding_text.as_bytes())),
        );
    }
    counts.sort_unstable();
    let percentile = |numerator: usize| counts[((clips - 1) * numerator) / 100];
    CorpusReport {
        clips,
        chunks,
        chunk_p50: percentile(50),
        chunk_p95: percentile(95),
        chunk_p99: percentile(99),
        chunk_max: *counts.last().unwrap_or(&0),
        unique_embedding_inputs: unique.len(),
        raw_vector_bytes: chunks as u64 * TARGET_VECTOR_DIMENSIONS as u64 * 4,
    }
}

#[test]
fn qualification_corpus_is_deterministic_and_mixed() {
    let first = corpus_report(100);
    let second = corpus_report(100);
    assert_eq!(first, second);
    assert_eq!(first.clips, 100);
    assert!(first.chunks >= first.clips);
    assert!(first.unique_embedding_inputs < first.chunks);
}

#[test]
#[ignore]
fn semantic_scale_qualification() {
    let started = Instant::now();
    let report = corpus_report(TARGET_CLIPS);
    eprintln!(
        "semantic-scale-report={} elapsed_ms={}",
        serde_json::to_string(&report).unwrap(),
        started.elapsed().as_millis()
    );
    assert_eq!(report.clips, TARGET_CLIPS);
}

#[test]
#[ignore]
fn quantized_flat_scale_qualification() {
    const ROWS: usize = 540_000;
    const DIMENSIONS: usize = 1_024;
    const RUNS: usize = 10;
    let threads = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(8);
    let mut vectors = vec![0_i8; ROWS * DIMENSIONS];
    for (index, value) in vectors.iter_mut().enumerate() {
        *value = ((index.wrapping_mul(31).wrapping_add(index / DIMENSIONS * 17) % 255) as i16 - 127)
            as i8;
    }
    let query = vectors[(ROWS / 2) * DIMENSIONS..(ROWS / 2 + 1) * DIMENSIONS].to_vec();
    let rows_per_worker = ROWS.div_ceil(threads);
    let mut elapsed = Vec::with_capacity(RUNS);
    let mut checksum = 0_i64;
    for _ in 0..RUNS {
        let started = Instant::now();
        checksum = std::thread::scope(|scope| {
            let mut workers = Vec::with_capacity(threads);
            for worker in 0..threads {
                let start_row = worker * rows_per_worker;
                let end_row = ((worker + 1) * rows_per_worker).min(ROWS);
                let slice = &vectors[start_row * DIMENSIONS..end_row * DIMENSIONS];
                let query = &query;
                workers.push(scope.spawn(move || {
                    slice
                        .chunks_exact(DIMENSIONS)
                        .map(|vector| {
                            vector
                                .iter()
                                .zip(query)
                                .map(|(&left, &right)| i32::from(left) * i32::from(right))
                                .sum::<i32>()
                        })
                        .max()
                        .unwrap_or_default() as i64
                }));
            }
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .sum()
        });
        elapsed.push(started.elapsed().as_micros());
    }
    elapsed.sort_unstable();
    eprintln!(
        "quantized-flat-report={{\"rows\":{ROWS},\"dimensions\":{DIMENSIONS},\"threads\":{threads},\"bytes\":{},\"checksum\":{checksum},\"p50_us\":{},\"p95_us\":{},\"p99_us\":{}}}",
        vectors.len(),
        elapsed[RUNS / 2],
        elapsed[RUNS - 1],
        elapsed[RUNS - 1],
    );
    assert_ne!(checksum, 0);
}

fn deterministic_unit_vector(key: u64, dimensions: usize) -> Vec<f32> {
    let mut state = key ^ 0x9E37_79B9_7F4A_7C15;
    let mut vector = Vec::with_capacity(dimensions);
    for _ in 0..dimensions {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        vector.push(((state >> 40) as i32 - (1 << 23)) as f32 / (1 << 23) as f32);
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    vector.iter_mut().for_each(|value| *value /= norm);
    vector
}

#[test]
#[ignore]
fn quantized_flat_recall_qualification() {
    const ROWS: usize = 10_000;
    const DIMENSIONS: usize = 256;
    const CANDIDATES: usize = 100;
    let vectors: Vec<Vec<f32>> = (1..=ROWS)
        .map(|key| deterministic_unit_vector(key as u64, DIMENSIONS))
        .collect();
    let quantized: Vec<Vec<i8>> = vectors
        .iter()
        .map(|vector| {
            vector
                .iter()
                .map(|value| (value * 127.0).round().clamp(-127.0, 127.0) as i8)
                .collect()
        })
        .collect();
    let mut recalls = Vec::new();
    for query_row in (0..ROWS).step_by(1_000) {
        let query = &vectors[query_row];
        let quantized_query = &quantized[query_row];
        let mut exact: Vec<_> = vectors
            .iter()
            .enumerate()
            .map(|(row, vector)| {
                (
                    row,
                    vector.iter().zip(query).map(|(a, b)| a * b).sum::<f32>(),
                )
            })
            .collect();
        exact.sort_unstable_by(|left, right| right.1.total_cmp(&left.1));
        let truth: HashSet<_> = exact.iter().take(10).map(|item| item.0).collect();
        let mut approximate: Vec<_> = quantized
            .iter()
            .enumerate()
            .map(|(row, vector)| {
                (
                    row,
                    vector
                        .iter()
                        .zip(quantized_query)
                        .map(|(&a, &b)| i32::from(a) * i32::from(b))
                        .sum::<i32>(),
                )
            })
            .collect();
        approximate.sort_unstable_by_key(|item| std::cmp::Reverse(item.1));
        let candidates: HashSet<_> = approximate
            .iter()
            .take(CANDIDATES)
            .map(|item| item.0)
            .collect();
        recalls.push(truth.intersection(&candidates).count() as f64 / 10.0);
    }
    let recall = recalls.iter().sum::<f64>() / recalls.len() as f64;
    eprintln!("quantized-flat-recall={{\"rows\":{ROWS},\"dimensions\":{DIMENSIONS},\"candidates\":{CANDIDATES},\"recall_at_10\":{recall:.3}}}");
    assert!(recall >= 0.95);
}
