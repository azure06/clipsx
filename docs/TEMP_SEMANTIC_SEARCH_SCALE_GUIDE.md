# Temporary guide: scaling ClipsX history and Meaning Search

> **Status:** planning and explanation only; not an implemented architecture contract.
>
> **Created:** 2026-08-29.
>
> This file exists so the rationale and proposed delivery plan are not lost with
> the conversation. Before implementation begins, accepted decisions must be
> copied into `ARCHITECTURE.md`, `MODELS.md`, and `ROADMAP.md`. Delete this file
> after those documents and the implementation agree.

## 1. The short version

ClipsX can support a history of roughly 60,000 clips. Ordinary history browsing
is already based on pages, which is a good foundation. The two areas that need
the most work are:

1. **Meaning Search:** the current implementation compares a query with every
   stored embedding. This becomes too slow when there are hundreds of thousands
   of embeddings.
2. **History presentation:** the backend does extra work per visible row, while
   the frontend eventually retains and renders every loaded row. This becomes
   expensive if somebody scrolls through a very large history.

The proposed solution is:

- Keep original clips and normal metadata in `clips.db`.
- Keep full-text search (FTS) in `clips.db`.
- Put large, disposable semantic-search data in one sidecar database file per
  index generation.
- Use an approximate-nearest-neighbor index after it passes performance,
  quality, recovery, and desktop-packaging tests.
- Keep only one production vector-search implementation.
- Bound the amount of semantic work one unusually large clip can create.
- Batch history-row loading and render only visible rows.
- Require a factory reset for the new schema. Do not build compatibility code.

This design keeps the canonical clipboard database durable and understandable,
while making the large AI-derived index safe to delete and rebuild.

## 2. First: what Meaning Search actually does

Traditional text search and Meaning Search solve different problems.

Suppose a stored clip contains:

> The application could not connect because the database password was wrong.

An ordinary keyword search for `database password` can find it because those
words occur in the clip. A search for `invalid credentials caused connection
failure` may not find it, because the words differ.

Meaning Search tries to recognize that the two sentences discuss similar ideas.
It works through these steps:

```text
Stored text -> embedding model -> vector -> vector index
User query  -> same model      -> vector -> nearest stored vectors
```

### 2.1 What is an embedding?

An embedding is a list of numbers produced by a model. The numbers represent
features of the input text in a mathematical space.

A real embedding may look conceptually like this:

```text
[0.014, -0.083, 0.121, ... 1,021 more numbers]
```

The individual numbers do not have useful human-readable labels. What matters
is distance: texts with related meanings should normally produce vectors that
are closer together than unrelated texts.

If a model produces 1,024 Float32 numbers, one vector requires:

```text
1,024 numbers x 4 bytes = 4,096 bytes
```

At an average of nine vectors per clip:

```text
60,000 clips x 9 vectors = 540,000 vectors
540,000 x 4,096 bytes = 2,211,840,000 bytes, about 2.06 GiB
```

That is only the raw vector data. Chunk text, database pages, lookup indexes,
and ANN structures require additional space.

### 2.2 Why does one clip have multiple vectors?

A model cannot represent every detail of a large document reliably in one
vector. ClipsX therefore divides text into **chunks**.

For example, a Markdown document could create chunks for:

- Its introduction.
- Each section under a heading.
- A table or code block.
- A note or the clip's tags.

When the user searches, ClipsX finds matching chunks and then returns the clips
that own those chunks.

ClipsX's current chunker already understands useful structure such as Markdown
headings, JSON paths, CSV headers, code declarations, HTML, RTF, OCR, notes,
and tags. The plan preserves this work.

## 3. Full-text search and Meaning Search

ClipsX should use both types of search.

| Search type | Good at | Example |
| --- | --- | --- |
| FTS5 | Exact words, prefixes, code symbols, paths, URLs and error codes | `ERR_CONNECTION_RESET` |
| Meaning Search | Concepts, paraphrases and related wording | `network connection unexpectedly closed` |

FTS is mandatory because exact text is especially important in a clipboard
manager. Meaning Search is optional because it needs an embedding provider and
more disk space.

The result pipeline is:

```text
                         +-> FTS candidates --------+
Query -> canonical filters                         +-> merge -> rank -> page
                         +-> semantic candidates ---+
```

The two lists are merged by clip ID. An exact literal, identifier, URL, path,
or code-symbol match receives special priority. Other results use reciprocal
rank fusion, described later.

## 4. What is a search generation?

In this design, **generation does not mean generative AI**. It means a complete
version of a derived search index.

Think of it like rebuilding a book's index:

- The old printed index remains available.
- A replacement index is prepared separately.
- The replacement is checked for completeness.
- Only then does it become the index readers use.
- The old copy can be removed afterward.

Each semantic generation is tied to:

- One embedding provider and model.
- The exact model revision.
- Vector dimensions and distance metric.
- The chunking-pipeline version.
- The vector-index backend and its configuration.

Changing any of these may require a new generation because vectors from
incompatible spaces must never be mixed.

### 4.1 Example generation lifecycle

Assume generation 3 is active and searchable:

```text
Generation 3: active
Generation 4: building
```

Generation 4 might be needed because the user selected a different embedding
model or ClipsX changed its chunking rules.

While generation 4 builds:

- Capturing and browsing clips continues.
- FTS continues.
- Meaning Search continues to use generation 3.
- The UI reports generation 4's progress.

After all generation-4 jobs succeed, ClipsX validates the new sidecar and
changes one active-generation record:

```text
Generation 3: superseded
Generation 4: active
```

That small activation transaction is the moment new searches switch. The old
generation file is removed later, after no query is using it.

### 4.2 How does a search choose the right generation?

A search must not inspect every generation or guess from filenames.

The algorithm is:

1. Read the single `active` generation row for the semantic search source from
   `clips.db`.
2. Read its approved relative sidecar path.
3. Open that sidecar read-only.
4. Verify that its generation ID, model compatibility hash, dimensions,
   metric, pipeline version, backend version, and sealed status match the row.
5. Embed the query using the model recorded for that active generation.
6. Search only that generation's vector index.

If the configured provider can no longer produce a query vector in the active
generation's space, Meaning Search is unavailable. ClipsX must not query the
index with a vector from another model. FTS remains available.

There is never more than one active generation per semantic search source. A
database constraint enforces that rule.

### 4.3 What happens to a new clip while a replacement is building?

The coordinator records semantic work for the generation being built. The
currently active generation can also receive an incremental update so the new
clip becomes searchable without waiting for the full rebuild.

This policy must remain centralized in `SemanticIndexService`; capture code
must not write sidecar tables directly. If maintaining both temporarily proves
too costly in benchmarks, the simpler allowed behavior is to index the clip in
the active generation immediately and enqueue it for the building generation.

## 5. Canonical data, derived data and sidecars

### 5.1 Canonical data

Canonical data is the information ClipsX must preserve to reconstruct and
present the original capture:

- Clip rows and timestamps.
- Original clipboard representations.
- Notes, favorites and tags.
- Managed binary files.

Losing canonical data means losing user data.

### 5.2 Derived data

Derived data can be recreated from canonical data:

- FTS documents.
- OCR output.
- Thumbnails and compact previews.
- Semantic chunks and embeddings.
- Vector indexes.

Losing derived data may temporarily remove a feature, but it must not damage a
clip.

### 5.3 Why use a sidecar?

A sidecar is an application-owned file stored next to, but separate from, the
canonical database.

Proposed ownership:

| Location | Authority |
| --- | --- |
| `clips.db` | Clips, representations, metadata, FTS, provider configuration, embedding spaces, generation lifecycle and jobs |
| `search-index/generation-{id}.sqlite` | Chunks, unique embedding inputs, vectors, mappings and ANN structures for exactly one generation |
| `SemanticIndexService` | The only component allowed to coordinate semantic index state |

Benefits:

- `clips.db` does not grow by several gigabytes of vectors.
- A damaged index can be deleted without touching clips.
- A superseded index can be reclaimed by deleting one file.
- Building a new generation does not modify the active file.
- Factory reset and “Delete Meaning Search index” have explicit targets.

The sidecar does **not** automatically make the vectors smaller. Size reduction
comes from deduplication, bounded chunking, and—only where measurements prove it
safe—vector-index compression or quantization.

## 6. Exact search and ANN

### 6.1 Exact vector search

Exact search compares the query vector with every eligible stored vector.

It provides the mathematically exact nearest neighbors, but its work grows
linearly:

```text
Twice as many vectors -> roughly twice as many comparisons
```

The current Rust implementation follows this method. It streams vectors from
SQLite and keeps the best chunk found for each clip.

Exact search is valuable as:

- A correctness reference for tests.
- A reasonable strategy for a small index.
- The source of truth when measuring ANN recall.

It should not remain as a separate production backend after the ANN cutover.
The chosen vector engine should expose both its exact-small and ANN-large modes
through one implementation.

### 6.2 Approximate-nearest-neighbor search

ANN builds a data structure that avoids comparing the query with every vector.
It asks, approximately, “which areas of this vector space are promising?” and
searches those areas first.

This trades a small amount of recall for a large speed improvement.

**Recall@10** answers this question:

> Of the true exact top ten results, how many did ANN return?

If ANN finds 19 of the exact top 20 results over many representative queries,
its recall@20 is 95%.

SQLite's official `vec1` extension was evaluated first. It supports exact and
approximate modes, regular inserts/deletes, filtered retrieval, and exact
reranking, but version 0.7 failed the Phase 0 correctness and persisted-index
integrity gates at the target size. ClipsX therefore does not adopt it. The
next isolated experiment evaluates a quantized HNSW backend; only one backend
may enter production.

### 6.3 Candidate retrieval and reranking

ANN should not directly decide the final user-visible order.

Instead:

1. ANN returns perhaps 200–500 promising vector IDs.
2. ClipsX computes exact cosine scores for that small candidate set.
3. Multiple chunks are reduced to the best chunk per clip.
4. FTS and semantic candidates are fused.

This keeps ANN fast while recovering much of exact ranking's quality.

## 7. Distance, cosine similarity and normalization

Cosine similarity measures how closely two vectors point in the same direction.
For normalized vectors, a dot product provides the same ordering efficiently.

The embedding-space definition records:

- Dimensions.
- Normalization policy.
- Distance metric.
- Provider, model and revision.

The existing implementation already rejects vectors with the wrong dimensions,
non-finite numbers, or an unexpected norm. Preserve those validations at the
provider boundary and when building the sidecar.

## 8. Deduplication

Clipboard histories often contain repeated content:

- The same command copied several times.
- Repeated CSV headers.
- Boilerplate code or error messages.
- Equivalent sibling representations.

The current chunk row owns its own vector. The proposed schema separates the
two concepts:

```text
Chunk -> enriched-input hash -> unique vector
```

The hash must cover the exact text sent to the provider, including contextual
prefixes such as a Markdown heading or JSON path. Hashing only the visible
snippet could incorrectly reuse vectors produced from different inputs.

Within a generation, identical enriched inputs share one vector. When a new
generation uses the same embedding space, it may copy a matching vector from
the active generation rather than calling the provider again.

No deduplication percentage should be promised until a representative corpus is
measured.

## 9. Bounding pathological clips

Without a global limit, a huge clipboard entry can create thousands of chunks,
provider requests, and vectors.

The proposed starting policy is:

- Small text: one semantic chunk.
- Normal structured text: format-aware detailed chunks.
- Very large text: one bounded routing/outline chunk plus representative detail
  chunks distributed across the content.
- Initial hard maximum: 64 semantic chunks per clip.
- FTS continues to cover all safely extracted text.

The exact limit must be verified with retrieval-quality tests. It is a safety
boundary, not a user preference: making it configurable would create many
untested index shapes.

## 10. Tokens, bytes and provider limits

Embedding models normally express input limits in tokens. A token is a unit
chosen by the model's tokenizer; it is not the same as a character, word, or
byte.

The same byte count can represent very different token counts for English,
Japanese, emoji, or source code. That is why byte-only chunking is an imperfect
proxy.

The safe policy is:

1. Use structural boundaries first.
2. Use the provider's exact token counter when it reliably exposes one.
3. Otherwise retain a conservative UTF-8 byte limit.
4. Keep recursive subdivision when the provider reports context overflow.
5. Make every retry respect the final clip-wide chunk limit.

ClipsX should not bundle a tokenizer that only approximates the selected model.
An incorrect “exact” token count is worse than an explicit byte fallback.

## 11. Jobs, workers and crash recovery

A job is a durable statement that one clip needs semantic indexing for one
generation.

Possible states are:

```text
pending -> running -> completed
                   -> pending again after a retryable failure
                   -> failed after the retry limit
```

The background worker must remain single-owner and bounded. It may batch work,
but multiple UI components must never run their own indexing loops.

### 11.1 Cross-file commit order

`clips.db` and a generation sidecar cannot safely pretend to be one transaction.
Use an idempotent order:

1. Replace the clip's sidecar chunks and vectors in a sidecar transaction.
2. Commit that transaction.
3. Mark the main-database job completed.

If the app stops after step 2, the job remains pending and safely repeats. The
sidecar operation deletes/replaces that clip's generation data, so repetition
does not duplicate it.

### 11.2 Missing or corrupt sidecar

On startup and before activation, validate:

- The file is within the owned search-index directory.
- Its header matches the expected generation.
- The SQLite integrity check passes.
- Dimensions and vector counts match.
- Sample queries return valid results.
- Every completed job has the expected projection hash.

If validation fails:

- Do not activate the generation.
- Continue using the previous valid generation if one exists.
- Otherwise expose FTS-only search.
- Delete or quarantine the invalid derived file and rebuild it.

## 12. Deletion and retention

Canonical deletion must succeed even if semantic cleanup fails.

Search results are therefore validated against live canonical clip rows. A
stale sidecar vector cannot make a deleted clip visible.

After deletion:

- Best-effort semantic cleanup removes the clip from the active sidecar.
- Startup reconciliation removes any missed rows.
- Excessive drift or tombstones trigger a rebuild.
- Clearing all history deletes all semantic generation files.

This keeps derived cleanup subordinate to canonical correctness.

## 13. Hybrid ranking

Reciprocal-rank fusion (RRF) combines ranked candidate lists without pretending
their raw scores are directly comparable.

For each source, a result receives approximately:

```text
1 / (constant + source rank)
```

The values from participating sources are added. A result found by both FTS and
Meaning Search naturally receives more evidence.

Before normal RRF ordering, use one explicit lexical tier for exact phrases,
identifiers, error codes, URLs, paths, and code symbols. This prevents a vague
semantic similarity from outranking the exact value the user copied.

Avoid a large collection of content-specific ranking weights until a labelled
search-quality corpus proves they are needed.

## 14. History browsing at 60,000 items

The current backend already uses keyset pagination, which scales better than
large SQL offsets for normal browsing. Preserve it.

Two other changes are needed.

### 14.1 Batch history-row hydration

Today a page loads base rows and then performs additional lookups per clip for
tags, compact presentation, OCR, files, or facets.

Instead, load one page using a small fixed number of batch queries:

1. Base summaries.
2. Tags for every ID in the page.
3. Compact presentations for every ID.
4. Any remaining preview inputs in category batches.
5. Assemble `ClipSummary` objects in Rust.

The number of SQL statements should remain approximately constant whether the
page contains 10 or 100 clips.

### 14.2 Virtualize frontend rows

Pagination limits network/IPC work, but the frontend currently renders every
row it has accumulated. A virtualized list renders only visible rows plus a
small buffer.

The End shortcut must also stop loading every page to reach the oldest clip.
Add a constant-query boundary/window endpoint that jumps directly to the oldest
page.

Keep frontend state explicit and small:

- Current query/filter identity.
- Loaded summaries.
- Next cursor.
- Request epoch.
- Loading/error state.
- Selected clip ID.

Initially keep loaded summaries because that is simple. Add a bounded page cache
only if the 60,000-item memory benchmark proves it necessary.

## 15. User experience during indexing

Capture and FTS must never wait for embedding work.

The Intelligence UI should report:

- Indexed clips versus eligible clips.
- Total chunks and unique vectors.
- Active model and dimensions.
- Current sidecar size.
- Rebuild progress.
- Estimated additional disk required before a rebuild starts.
- Clear/rebuild controls.
- An actionable explanation when the provider or index is unavailable.

During a rebuild, the UI should say that Meaning Search continues using the
previous generation. If no valid generation exists, it should say that ordinary
text search remains available.

Low disk space must stop a rebuild before it consumes the remaining disk. Do
not implement a hidden in-place low-disk rebuild path; ask the user to clear the
old Meaning Search index or free space.

## 16. Things deliberately not proposed

To keep the design small and maintainable:

- No remote vector database or background server.
- No compatibility migration or dual schema.
- No two production vector backends.
- No embeddings in canonical clip rows.
- No persisted renderer selection.
- No arbitrary tokenizer pretending to match every embedding model.
- No per-component indexing workers.
- No user-configurable collection of low-level ANN parameters.
- No silent exclusion of old history from Meaning Search.
- No promise that a sidecar alone reduces disk size.

## 17. Implementation phases

No implementation phase starts until the previous phase's exit gate is met.

### Phase 0: qualify the design and backend

Create a deterministic corpus representing 60,000 clips and the observed data
distribution. The corpus must include English, Japanese, code, Markdown, JSON,
CSV, HTML, OCR, URLs, paths, repeated boilerplate, large clips and deleted clips.

Measure:

- Chunk-count median, p95, p99 and maximum.
- Unique enriched-input ratio.
- Vector dimensions and raw bytes.
- Exact baseline latency.
- ANN p50, p95 and p99 latency.
- Recall@10 and recall@50 against exact search.
- Incremental insert, update and deletion cost.
- Full-build duration.
- Steady and rebuild-peak disk usage.
- Search and build peak memory.
- Corruption and interrupted-build recovery.
- Windows, Linux and both macOS architecture builds.

Provisional acceptance gates:

- Recall@10 of at least 95%.
- Local retrieval and exact reranking p95 at or below 75 ms for 540,000
  vectors, excluding query-provider latency.
- No capture or UI blocking during background indexing.
- A measured and displayed rebuild-space estimate.
- Missing/corrupt sidecars degrade safely to FTS.
- The backend passes installed-build tests on every advertised platform.

If `vec1` fails, stop. Evaluate a quantized HNSW backend as a replacement in a
new qualification experiment. Do not keep both implementations.

### Phase 1: approve architecture and reset contract

- Copy accepted decisions into `ARCHITECTURE.md`.
- Update `MODELS.md` with exact ownership and tables.
- Add roadmap tasks and exit gates.
- Bump the fresh schema version.
- Edit baseline migrations instead of adding compatibility migrations.
- Make the old database require the existing explicit reset flow.
- Add the search-index root to factory reset.
- Specify the independent “Delete Meaning Search index” behavior.

**Exit gate:** the stable documents fully define ownership, crash behavior,
activation and deletion before persistence code lands.

### Phase 2: implement sidecar persistence

- Add the owned `search-index/` root.
- Implement `SemanticIndexStore`.
- Create, open, validate and remove generation files.
- Enforce relative-path and owned-root checks.
- Add generation headers and schema-version validation.
- Add chunk, unique-input and chunk-to-vector storage.
- Make per-clip replacement idempotent.
- Add startup reconciliation and orphan-file garbage collection.

**Exit gate:** a generated sidecar can be destroyed and rebuilt without changing
the checksum or behavior of any canonical clip representation.

### Phase 3: bound chunking and provider work

- Introduce one deterministic chunking policy.
- Add the 64-chunk initial safety limit.
- Add routing/outline chunks for large inputs.
- Hash the complete enriched embedding input.
- Reuse identical vectors within a generation.
- Reuse active-generation vectors when the embedding space is identical.
- Add optional provider token limits and exact token counting.
- Retain byte fallback and bounded recursive subdivision.
- Bound embedding batches by item count and total input size.

**Exit gate:** pathological inputs cannot exceed the documented work budget,
and representative retrieval quality remains acceptable.

### Phase 4: implement generation building and activation

- Bulk-enqueue initial jobs using `INSERT ... SELECT`.
- Keep one bounded background coordinator.
- Use sidecar-first, job-second commit ordering.
- Continue searching the old active generation while building.
- Validate counts, hashes, dimensions, integrity and sample queries.
- Seal the building generation before activation.
- Switch the active generation in one main-database transaction.
- Remove superseded files after active readers release them.
- Add crash injection at every transition.

**Exit gate:** interruption at any tested instruction boundary leaves either the
old generation active or the new generation safely recoverable—never a guessed
or partially active index.

### Phase 5: replace semantic retrieval

- Embed the query in the active generation's space.
- Search the chosen vector backend.
- Apply canonical filters without materializing every eligible clip ID in Rust.
- Retrieve a bounded ANN candidate set.
- Rerank candidates exactly.
- Keep the best chunk per clip.
- Add the literal lexical tier and retain RRF for other results.
- Preserve FTS results when the optional semantic source fails.
- Preserve deterministic cursor pagination.

Delete in the same cutover:

- Main-database `search_chunks` and `search_embeddings`.
- Float32-BLOB exact scanner and bounded heap.
- In-memory semantic eligible-ID materialization.
- Old vector cleanup SQL.
- The per-row `hasEmbedding` history lookup and badge.
- Any experimental backend that was not selected.

**Exit gate:** only one semantic retrieval implementation remains, and its
quality/performance gates pass at the target corpus size.

### Phase 6: scale normal history browsing

- Replace per-item summary enrichment with batch hydration.
- Confirm indexes cover every browse scope and cursor order.
- Virtualize list and grid rows.
- Replace load-all End behavior with a boundary/window query.
- Put pagination cursor state inside the clipboard store.
- Test selection, mutation and scroll anchoring with large histories.
- Add a bounded frontend page cache only if measured memory requires it.

**Exit gate:** 60,000-item history browsing stays responsive, the DOM remains
bounded, and one keyboard command never downloads the complete history.

### Phase 7: add operations and user feedback

- Show progress, coverage, model, dimensions and disk usage.
- Estimate required rebuild space before starting.
- Expose retry, rebuild and delete-index actions.
- Explain FTS-only fallback.
- Ensure disabling or deleting Meaning Search never changes clips.
- Add low-disk, missing-provider and corrupt-index recovery messages.

**Exit gate:** every failure state is understandable and recoverable without a
terminal or database editing.

### Phase 8: certify the installed application

- Run unit, integration, property and crash tests.
- Run the labelled search-quality corpus.
- Run 60,000-item installed-build performance tests.
- Verify idle and rebuild memory/disk budgets.
- Verify capture responsiveness during a rebuild.
- Verify Windows, Linux, macOS ARM and macOS Intel packaging.
- Record results in release documentation.

**Exit gate:** ClipsX makes no 60,000-item Meaning Search claim until installed
artifacts meet the quality, latency, recovery and storage budgets.

## 18. Proposed code ownership after the change

The exact filenames may change, but responsibilities should remain narrow:

```text
search/
├── mod.rs                 search planner, candidate fusion and pagination
├── fts.rs                 FTS projection and lexical candidates
└── semantic/
    ├── mod.rs             public semantic-search API
    ├── service.rs         generation/job coordinator
    ├── chunking.rs        format-aware deterministic chunking
    ├── index_store.rs     sidecar lifecycle and selected vector backend
    ├── retrieval.rs       candidate search and exact reranking
    └── reconciliation.rs  startup repair and orphan cleanup
```

Avoid duplicating SQL or state transitions across IPC commands, capture code,
workers and UI. Those callers request work from the semantic service; they do
not implement it.

## 19. Questions Phase 0 must answer with data

These should not be decided from intuition alone:

1. What are the real chunk-count median, p95 and maximum?
2. How many enriched embedding inputs are duplicates?
3. Is 64 chunks per clip sufficient for search quality?
4. Which ANN settings meet recall and latency targets?
5. What are steady and rebuild-peak disk sizes?
6. Is `vec1` safe and easy to statically package on every release target?
7. How much RAM does training, building and querying use?
8. How often do narrow filters require deeper ANN candidate retrieval?
9. Is history-summary batching enough, or is a persisted preview cache needed?
10. Does retaining every intentionally loaded summary fit the frontend memory
    budget, or is a bounded page cache justified?

## 20. Final decision summary

The proposed direction is feasible and consistent with ClipsX's local-first
architecture if implementation follows these rules:

- Canonical clips never depend on semantic indexing.
- One coordinator owns generation state.
- One active generation is selected explicitly, never guessed.
- One production vector backend remains after qualification.
- A sidecar is disposable and self-validating.
- The old index stays active until the replacement is complete.
- Chunk and provider work are globally bounded per clip.
- FTS remains mandatory and exact text retains priority.
- Deleted clips cannot reappear through stale derived data.
- Large-history UI work is paged, batched and virtualized.
- The schema is reset rather than migrated or dual-written.

That produces a system that is faster at scale without making canonical storage,
capture, or the frontend responsible for AI-index lifecycle details.
