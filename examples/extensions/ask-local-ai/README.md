# Ask Local AI

A capability-backed Extension API v2 example. It sends selected text to the
host-owned `generation.text` provider and never receives the configured Ollama
endpoint or model. The action is hidden for non-text clips, disabled for empty
or oversized text, and offers host-generated parameter controls for its
instruction and output disposition.

Build with `cargo build --release --target wasm32-unknown-unknown`, copy the
resulting core module to `component.wasm`, then package it with the repository
extension packaging script. The packaging script converts it to a Component
Model artifact with only the declared ClipsX broker import; do not build this
example with `wasm32-wasip2`, which adds ambient WASI imports that ClipsX rejects.
