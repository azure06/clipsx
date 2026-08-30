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
        source_kind: if family == 4 {
            "representation"
        } else {
            "representation"
        }
        .into(),
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
