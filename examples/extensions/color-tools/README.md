# Color Tools example

This API v2 example demonstrates a detector, detail and compact renderer,
transformer, transformer-preset actions, and host-owned color swatches.

Build and package from the repository root:

```powershell
rustup target add wasm32-unknown-unknown
cargo build --manifest-path examples/extensions/color-tools/Cargo.toml --target wasm32-unknown-unknown --release
Copy-Item examples/extensions/color-tools/target/wasm32-unknown-unknown/release/clipsx_color_tools.wasm examples/extensions/color-tools/component.wasm
npm run extension:pack -- examples/extensions/color-tools dist/color-tools.clipsx
npm run extension:validate -- dist/color-tools.clipsx
```

Enable Developer Mode in ClipsX and install the resulting `.clipsx` package.
The package tool generates a component that imports no WASI or host APIs.
