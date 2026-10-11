# Third-party notices

ClipsX incorporates third-party open-source packages listed in `package-lock.json`
and `src-tauri/Cargo.lock`. Each package remains subject to its own license and
copyright notices. The Apache License 2.0 for ClipsX does not replace those terms.

Release candidates enforce the JavaScript policy with `npm run license:check`
and the Rust policy with `cargo deny check licenses bans sources`. The release
SBOM is the complete machine-readable dependency inventory for the exact build.

## Provider logo assets

Ollama, Claude, OpenAI, OpenRouter, and Gemini SVG marks are vendored from
[LobeHub Icons](https://github.com/lobehub/lobe-icons) under the MIT License.
The source revision and full license notice are retained in
[src/features/intelligence/provider-logos](src/features/intelligence/provider-logos/README.md).
