# ADR 0004: provider boundaries

Status: Accepted

Providers are selected locally and contacted directly by the desktop app. FTS
works without a provider. Secrets remain in OS secure storage and hosted calls
require explicit consent. No ClipsX model proxy is introduced.

Provider capabilities are distinct host-owned contracts: text embedding,
visual embedding, vision description, generation, and OCR. Visual embedding
must map images and text queries into one proven-compatible multimodal space;
vision description produces derived text and is not visual similarity search.
Community WASM extensions cannot register model providers. Disabled providers
are valid defaults and provider absence never disables FTS or history.
