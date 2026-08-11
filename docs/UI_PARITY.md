# UI Parity Matrix

This is the delivery gate for the restored v1 desktop experience on the v2
architecture. The archived source is a visual and interaction reference only;
no row authorizes legacy schema, canonical `ClipItem`, or legacy IPC.

| Area | v2 owner | Status | Acceptance gate |
| --- | --- | --- | --- |
| Glass shell, title drag region, sidebar, history split, themes, i18n | React shell | restored | desktop visual and focus smoke tests |
| History pagination, scopes, tags, notes, pin/favorite, deletion | history + React store | in progress | cursor, event, tag/note search tests |
| Resolver-selected preview, alternate views, raw inspector | contributions + React | in progress | HTML/image/JSON/Office view tests |
| Original/plain copy and paste | output policy | in progress | reconstruction tests after restart |
| Contextual actions and transforms | host actions + TransformService | in progress | cached preview/copy/paste/save tests |
| Capture filters, retention, privacy and window settings | AppSettings | in progress | persistence and runtime-effect tests |
| Ollama and OCR providers | provider host | in progress | unavailable/configured/fallback tests |
| Core and WASM utility catalog | contributions + extensions | in progress | registry/quarantine/recovery tests |
| Account, tray, deep links, autostart and updater | desktop host | pending | Windows/macOS/Linux desktop smoke tests |

## Explicit exclusions

- Encrypted vault, Pro entitlement gating, remote sync, visual semantic search,
  vision models, and generation are not part of local parity.
- Community extensions remain capability-free WASM. OCR, Ollama, account, and
  desktop integration are trusted host boundaries.

## Invariants

- A representation's MIME/native identity comes from the platform adapter;
  detectors add facets and never rewrite canonical identity.
- Rendering is view policy. Only explicit transformations create different
  bytes; normal copy/paste uses `Original` or explicit `PlainText` policy.
- Notes and tag names participate in the derived search projection and refresh
  FTS/embeddings on every mutation.
