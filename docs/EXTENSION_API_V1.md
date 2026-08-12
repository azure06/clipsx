# Extension API v1

**Delivery status:** the package format, runtime isolation, validation,
resource limits, quarantine, service, and registry backend are implemented.
The end-user registry/developer installation workflow, diagnostics, recovery,
and transformer workflow remain partial and are scheduled for recovery
milestone R6. Extension renderer output now uses the exhaustive typed host
presentation boundary and retains host fallback. See [ROADMAP.md](ROADMAP.md) and
[UI_PARITY.md](UI_PARITY.md). This page defines the stable API contract; it is
not a claim of complete product delivery.

ClipsX extensions are checksum-pinned `.clipsx` packages containing a
`clipsx-extension.toml` manifest and `component.wasm` WebAssembly Component.
They run without WASI or any other imports: extensions have no filesystem,
network, clipboard, history, database, shell, environment, secret, provider,
or frontend-code access.

## Package and registry

The official registry is
`https://raw.githubusercontent.com/azure06/clipsx-registry/main/index.json`.
Registry entries pin package ID, version, compatible API version, GitHub
release URL, and complete archive SHA-256. ClipsX accepts only HTTPS GitHub
release URLs and GitHub-owned HTTPS redirects. The last valid index is cached,
so a registry outage never disables installed packages.

Archives may contain only root-level `clipsx-extension.toml`, `component.wasm`,
and optional `README.md`/`LICENSE`. Limits are 16 MiB compressed, 32 MiB
expanded, and 8 MiB for the component. Developer Mode permits local `.clipsx`
files through the native picker, but does not bypass manifest, compatibility,
hash, sandbox, or resource validation.

## WIT world

`src-tauri/wit/clipsx-extension.wit` defines `clipsx:extension@1.0.0`. It
exports `detect`, `render`, and `transform` and imports nothing. Contribution
IDs are local to a package; the host exposes them as `{package-id}/{local-id}`.
Detector facets are stored as `{package-id}.{facet-id}` and must be declared,
JSON objects, and carry `schemaVersion: 1`.

Inputs contain one ready representation (text, binary, or file list), its
format key/MIME/storage kind, and optional validated facet. They are limited to
1 MiB. Renderer output is structured text/code/markdown/table/tree/key-value,
input-image reference, or error; community renderers cannot emit HTML.
Transformer output is one to eight text or binary MIME representations, never
native types or file lists, and is capped at 10 MiB before entering the normal
preview/copy/paste/save path.

## Runtime and failure policy

Each call gets a fresh Wasmtime store with no linked host APIs, 64 MiB linear
memory, one memory/table/instance, 2 MiB stack, 1 MiB guest-to-host transfer,
and fuel limits of 10 million instructions for detect/render or 50 million for
transform. Epoch interruption enforces 100 ms detector, 250 ms renderer, and
500 ms transformer deadlines.

Successful calls reset that contribution's failure streak. Three consecutive
runtime failures quarantine the whole package, remove its derived facets/jobs
from the catalog, and require explicit re-enable. A renderer failure falls back
to ClipsX's original representation; a transformer failure produces no result.
