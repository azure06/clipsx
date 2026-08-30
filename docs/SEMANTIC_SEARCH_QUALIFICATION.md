# Semantic Search Qualification

Status: SQLite `vec1` rejected on the Windows qualification gate. This
document records measurements; it does not make a release claim.

## Decision under test

ClipsX qualified SQLite `vec1` as its first vector-search candidate. The
candidate is attractive because it is a portable, dependency-free C extension,
keeps the index in SQLite, supports exact and approximate search, accepts
ordinary inserts and deletes, and supports exact reranking.

This is not an adoption decision. Version 0.7 is pre-1.0, its own roadmap
says testing is insufficient, and approximate search requires a trained IVF/OPQ
model. Those constraints make quality, crash recovery, packaging, and rebuild
costs release gates rather than assumptions.

Official references:

- <https://sqlite.org/vec1/doc/trunk/doc/vec1.md>
- <https://sqlite.org/vec1/doc/trunk/doc/vec1intro.md>
- <https://sqlite.org/vec1/doc/trunk/doc/vec1test.md>

## Reproducible corpus

The ignored `semantic_scale_qualification` Rust test generates 60,000 synthetic
fixtures deterministically and passes them through ClipsX's real chunking pipeline. It
includes plain text, English and Japanese, Markdown, code, JSON, CSV, HTML,
URLs, paths, repeated boilerplate, and long inputs. The emitted JSON records:

- chunk-count p50, p95, p99, and maximum;
- total chunks and unique complete embedding inputs;
- raw float32 vector bytes at 1,024 dimensions;
- corpus processing time.

This mixed corpus tests determinism and pathological formats; it is not claimed
to reproduce a real user's frequency distribution. Backend performance tests
must independently seed the conservative capacity target of 540,000 vectors.

Run a release build so debug-mode timings are not mistaken for product data:

```powershell
cargo test --release --manifest-path src-tauri/Cargo.toml \
  semantic_scale_qualification -- --ignored --nocapture
```

The existing `exact_vector_scan_benchmark` remains the exact-scan baseline.
Backend qualification must add results for p50/p95/p99 retrieval, recall@10 and
recall@50 against that exact baseline, inserts, updates, deletes, full build,
steady/rebuild disk, peak memory, interruption, and corruption.

## Acceptance gates

`vec1` would have been accepted only if all of these passed:

- recall@10 is at least 95%;
- retrieval plus exact reranking p95 is at most 75 ms at 540,000 vectors,
  excluding embedding-provider latency;
- indexing never blocks capture or UI work;
- rebuild space is measured before a rebuild begins;
- missing, interrupted, or corrupt derived files fall back to FTS;
- Windows x64, Linux x64, macOS x64, and macOS arm64 packages load and query
  the statically packaged extension.

The experiment stopped because correctness and integrity failed. A quantized
HNSW backend must now be qualified separately; ClipsX will not retain `vec1`
as a second production backend.

## Evidence table

| Evidence | Result | Gate |
| --- | --- | --- |
| Deterministic mixed-corpus harness | 60,000 clips; 77,900 chunks; p50 1, p95/p99/max 3; 71,901 unique inputs; 319,078,400 raw vector bytes; 622 ms release run | Required foundation |
| Current Rust exact scan, 5k × 1,024 release | p50 4.575 ms; p95/p99 4.836 ms | Small-set baseline |
| Current Rust exact scan, 540k × 1,024 release | p50 493.352 ms; p95/p99 506.273 ms | Fails the 75 ms gate |
| Official `vec1` packaging | 0.7 compiled with MSVC/AVX2 and loaded from Python SQLite on Windows x64 | Passed locally |
| 540k × 1,024 flat exact | p95 1,740.331 ms | Failed latency |
| 540k × 1,024 ANN + exact rerank | p95 2.242 ms at 100 candidates / 10% buckets | Passed latency |
| Recall@10 | 10%; parameter sweep reached at most 20% | Failed 95% gate |
| Build and storage | 9.618 s insert; 98.680 s training; 77.700 s build; 2,515,091,456-byte database | Recorded |
| Committed close/reopen integrity | `PRAGMA integrity_check` reported stored PQ mismatch at row 217680 | Failed integrity |
| Other release targets | Not run after hard Windows rejection | Stopped |

The dense corpus is synthetic and not a substitute for a labelled clipboard
quality set. Its recall alone would require more investigation, but the
committed close/reopen integrity failure independently rejects the candidate.
Phase 1 may define a replaceable backend boundary and sidecar ownership, but
production retrieval must use a separately qualified backend.
