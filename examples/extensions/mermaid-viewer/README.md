# Mermaid Viewer

Build and package from the repository root:

```powershell
cargo build --release --target wasm32-unknown-unknown --manifest-path examples/extensions/mermaid-viewer/Cargo.toml
Copy-Item examples/extensions/mermaid-viewer/target/wasm32-unknown-unknown/release/clipsx_mermaid_viewer.wasm examples/extensions/mermaid-viewer/component.wasm
npm run extension:pack -- examples/extensions/mermaid-viewer dist/mermaid-viewer.clipsx
npm run extension:validate -- dist/mermaid-viewer.clipsx
```

Detection runs in WASM. The detail UI is fully bundled, offline, and uses only
DOM text APIs so diagram labels cannot inject markup. Unsupported syntax retains
an accessible source fallback.

The package tool converts the core module to a no-WASI Component Model artifact.
Do not build this example with `wasm32-wasip2`.

The contribution icon is the Mermaid mark published at
<https://static.mermaidchart.dev/assets/mermaid-icon.svg>.
