# ClipsX Architecture

ClipsX is a local-first programmable clipboard following
`Capture -> Understand -> Render / Transform -> Copy or Paste`.

> Raw representations are canonical. Facets, artifacts, search documents,
> chunks, and embeddings are derived. Render and transform previews are
> ephemeral unless explicitly saved.

Milestones live in [ARCHITECTURE_EXECUTION_PLAN.md](ARCHITECTURE_EXECUTION_PLAN.md)
and durable decisions in [adr/](adr/).

## System context

```mermaid
flowchart LR
  User --> UI[React desktop UI]
  UI <--> Host[Tauri / Rust host]
  Host <--> OS[OS clipboard and paste APIs]
  Host <--> DB[(SQLite catalog)]
  Host <--> Files[Managed immutable files]
  Host --> Local[Optional local providers]
  Host -. explicit consent .-> Remote[Future hosted providers]
```

SQLite owns relationships, jobs, configuration, and rebuildable indexes.
Binary clipboard payloads live in content-addressed managed files. Providers
are contacted directly by the desktop host; ClipsX has no model proxy.

## Backend modules

```mermaid
flowchart TB
  App[app: composition and workers] --> IPC[IPC commands]
  App --> Domains
  IPC --> Domains
  subgraph Domains
    Clipboard[clipboard]
    History[history]
    Contributions[detector / renderer / transformer]
    Artifacts[artifacts]
    Search[FTS / semantic]
    Output[reconstruction / paste]
  end
  Domains --> Foundation[foundation: DB, paths, managed files]
  Domains --> Contracts[provider contracts]
  Providers[provider implementations] --> Contracts
```

Dependency direction is `app/IPC -> domain services -> repositories/provider
contracts`. Domain modules do not depend on Tauri. Provider implementations
receive explicit immutable input and cannot access history, SQLite, clipboard,
or arbitrary files.

## Coherent capture

```mermaid
sequenceDiagram
  participant OS as OS clipboard
  participant A as ClipboardAdapter
  participant C as Capture coordinator
  participant DB as SQLite
  participant FS as Managed files
  C->>A: read change token
  A->>OS: enumerate and read supported formats
  C->>A: re-read change token
  alt changed or supported format failed
    C-->>C: reject and bounded retry
  else coherent snapshot
    C->>FS: stage and hash binary assets
    C->>DB: insert pending clip and representations
    C->>FS: commit content-addressed files
    C->>DB: mark files, representations, and clip ready
    C-->>DB: enqueue derived jobs
  end
```

One ownership state creates one clip with multiple representations. Unknown
native types are retained but written back only when the platform matrix
explicitly permits them. Native types are never guessed.

## Understand, render, transform, and output

```mermaid
flowchart LR
  Raw[Ready representations] --> Detect[Detector registry]
  Detect --> Facets[Additive facets]
  Raw --> Resolve[Renderer resolver]
  Facets --> Resolve
  Prefs[Global preferences] --> Resolve
  Resolve --> Model[Structured RenderModel]
  Model --> UI[ClipsX React renderer]
  Raw --> Transform[Transformer registry]
  Transform --> Cache[Ephemeral result cache]
  Cache --> Preview
  Cache --> Writer[Unified clipboard writer]
  Cache -->|explicit save| NewClip[New canonical clip]
  Writer --> Paste[Optional focus restore and paste]
```

Detectors are additive. Renderers return structured models, never frontend
code. Preview, copy, paste, and save consume the same transformation result.

## Search

```mermaid
flowchart TB
  Raw[Ready representations] --> Projection[Deterministic FTS projection]
  Artifacts[Approved OCR / extraction artifacts] --> Projection
  Note[User note] --> Projection
  Projection --> FTS[(FTS5)]
  Projection --> Chunker[Format-aware chunker]
  Chunker --> Jobs[Resumable jobs]
  Jobs --> Provider[Text embedding provider]
  Provider --> Space[(Immutable embedding space)]
  Query --> FTSRank[FTS rank]
  Query --> Provider
  Space --> VectorRank[Best chunk per clip]
  FTSRank --> RRF[Reciprocal-rank fusion]
  VectorRank --> RRF
```

FTS always works. Provider failures return FTS results with a diagnostic.
Incompatible provider/model/vector spaces are never mixed.

## Provider capabilities

```mermaid
classDiagram
  class TextEmbeddingProvider {
    +describe()
    +embed_documents(texts)
    +embed_queries(texts)
  }
  class VisualEmbeddingProvider {
    +describe()
    +embed_images(images)
    +embed_text_queries(texts)
  }
  class VisionDescriptionProvider {
    +describe_images(images)
  }
  class GenerationProvider
  class OcrProvider
  TextEmbeddingProvider <|.. Ollama
  VisualEmbeddingProvider <|.. DisabledVisualProvider
```

Visual embeddings require image and text-query vectors in one multimodal space.
Vision descriptions produce inspectable derived text; they are complementary
and are never presented as visual similarity embeddings.

## Data ownership

```mermaid
flowchart LR
  subgraph Canonical
    Clips[clip rows and organization]
    Reps[raw text, file lists, managed bytes]
  end
  subgraph Derived
    Facets
    Artifacts
    Indexes[FTS, chunks, embeddings]
  end
  subgraph Ephemeral
    Render[active renderer / RenderModel]
    Transform[transform result cache]
  end
  Canonical --> Derived
  Canonical --> Ephemeral
  Derived --> Ephemeral
  Transform -->|explicit save| Clips
```

Derived state can be cleared or rebuilt without changing canonical captures.

## Extensions and provider isolation

```mermaid
flowchart LR
  Registry[Checksum-pinned registry] --> Host[Extension host]
  Host --> WASM[Sandboxed WASM]
  WASM --> Structured[Facet / RenderModel / representations]
  Structured --> Domains[Host services]
  ProviderRegistry[Host provider registry] --> Provider[Trusted adapter]
  Provider --> Model[Local or consented remote model]
  WASM -. cannot register .-> ProviderRegistry
```

WASM receives bounded input and has no direct database, filesystem, network,
shell, environment, clipboard, history, or React access. Providers remain
host-owned because they involve consent, credentials, runtimes, and vector-space
integrity.

## Frontend organization

React capabilities live under `src/features`: history, search, inspector,
transformations, settings, and tags. `src/app/App.tsx` only composes the product.
The `v1-pre-m0-reference` tag remains the behavioral blueprint for selection,
shortcuts, accessibility, focus restoration, and macOS IME handling—not legacy
data or IPC types.
