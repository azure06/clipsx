# Ask AI

Build and package from the repository root:

```powershell
cargo build --release --target wasm32-wasip2 --manifest-path examples/extensions/ask-ai/Cargo.toml
Copy-Item examples/extensions/ask-ai/target/wasm32-wasip2/release/clipsx_ask_ai.wasm examples/extensions/ask-ai/component.wasm
npm run extension:pack -- examples/extensions/ask-ai dist/ask-ai.clipsx
npm run extension:validate -- dist/ask-ai.clipsx
```

The package opens only its declared ChatGPT and Claude origins. URL prompts are
UTF-8 percent encoded and the WASM `action-state` export disables prompts that
would exceed the host's URL limit.
