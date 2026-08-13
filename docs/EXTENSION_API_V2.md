# Extension API v2

Extension API v2 is ClipsX's local, host-governed extension contract. A package may detect meaning, present a clip, transform bytes, and expose contextual actions, but it never receives ambient system access.

The canonical ABI is [`src-tauri/wit/clipsx-extension.wit`](../src-tauri/wit/clipsx-extension.wit). The Rust example and SDK template live in [`examples/extensions/color-tools`](../examples/extensions/color-tools).

## Package and lifecycle

A `.clipsx` file is a ZIP archive with root-level `clipsx-extension.toml` and `component.wasm`; `README.md` and `LICENSE` are optional. Other paths and files are rejected. Manifests use `schemaVersion = 2` and an `apiVersion` semver requirement compatible with the host's `2.0.0` API. V1 packages are rejected with an explicit rebuild message.

Registry installs are checksum-pinned. Local packages require Developer Mode, are inspected before installation, and disclose declared HTTP origins, credential slots, and unavailable capability-backed contributions. Installed bytes live in app-owned storage. Enablement, runtime failures, and quarantine state live in SQLite.

Build and package the example with:

```powershell
rustup target add wasm32-wasip2
cargo build --manifest-path examples/extensions/color-tools/Cargo.toml --target wasm32-wasip2 --release
Copy-Item examples/extensions/color-tools/target/wasm32-wasip2/release/clipsx_color_tools.wasm examples/extensions/color-tools/component.wasm
npm run extension:pack -- examples/extensions/color-tools color-tools.clipsx
npm run extension:validate -- color-tools.clipsx
```

## Contributions

- A detector consumes a bounded representation and emits declared, additive facets.
- A renderer emits typed detail and/or compact presentation models.
- A transformer emits reusable representations through the same expiring result pipeline used by preview, Copy, Paste, and Save.
- An action is an explicit command implemented by a transformer preset or the `run-action` guest export.

Contribution IDs are stable inside their package and are qualified as `packageId/localId`. A contribution version participates in derived-output invalidation.

## Matching

Every matcher clause may contain `facetIds`, `capabilityIds`, `formatFamilies`, `formatKeys`, `mimeTypes`, and `storageKinds`. Clauses are ORed; populated fields within one clause are ANDed; values within a field are ORed. Storage kinds are `text`, `binary_asset`, and `file_list`.

Renderers and actions must declare at least one non-empty matcher. There is no wildcard renderer or action. For example:

```toml
[[contributions.matchers]]
facetIds = ["example.color-tools.color"]
mimeTypes = ["text/plain"]

[[contributions.matchers]]
capabilityIds = ["windows.png", "macos.png", "x11.png"]
```

The first clause requires both the facet and MIME. The second clause is an alternative.

## Typed presentation

Renderers declare one required purpose—`faithful`, `structured`, `semantic`, `source`, or `diagnostic`—and one or both surfaces: `detail` and `compact`. Numeric public priority does not exist.

Detail output supports text, code, Markdown, table, tree, key/value, card, host-managed input image, and error models. Cards contain a leading visual, title, optional subtitle, and bounded fields. Compact output contains one leading visual, optional title/subtitle/badge, and a required accessibility label.

Leading visuals are `none`, a named host icon, RGBA swatch, managed input thumbnail, or one/two-character monogram. The host validates sizes and values and owns rendering. Extensions cannot provide HTML, React, CSS, SVG, script, or asset URLs.

Compact models are computed after capture/redetection and stored as versioned derived data. History scrolling reads this cache only; it never starts WASM or network work. Missing, stale, or invalid compact output falls back to the core summary and icon.

Primary detail selection first honors saved facet, capability, then MIME preferences. Otherwise, image/file/document/Office content prefers faithful views. Text content prefers structured, semantic, faithful, source, then diagnostic views. Matcher specificity, capture priority, native ordinal, and stable contribution ID break ties. Tabs use the same purpose ordering. This intentionally lets valid JSON outrank an HTML alternative while allowing rich HTML to lead when no more specific interpretation exists.

## Transformers and actions

Transformers declare `local` or `capability_backed` execution. Local transforms are offline and reproducible. Capability-backed transforms validate today but remain unavailable until the broker is implemented.

Actions declare a host icon, matchers, parameter schema, effects, and execution class. A transformer preset names a transformer, parameters, and `preview`, `copy`, `paste`, or `save_as_clip` disposition. A guest action returns one audited result:

- bounded output for preview/copy/paste/save;
- a validated HTTPS URL; or
- a bounded notification.

The returned effect must have been declared by the action. Outputs use the normal transform-result cache so every disposition consumes identical bytes and provenance. Actions cannot mutate/delete clips, edit tags or notes, access arbitrary files, launch programs, or execute a shell.

Users may assign app-local shortcuts. ClipsX persists assignments per device, rejects duplicate accelerators, and targets the currently selected clip. Extensions cannot activate a shortcut themselves. Global action shortcuts are not part of v2.

## Permissions and isolation

The current v2 world imports no host functions and runs without WASI. Guests receive only the selected, host-approved representation/facet context and cannot access the clipboard, history, database, filesystem, environment, frontend, shell, providers, network, or credentials. Inputs remain limited to 1 MiB. The host applies fresh stores, fuel, memory, stack, transfer, deadline, output, failure-streak, and quarantine limits.

Manifests may declare future broker permissions as exact HTTPS origins, approved methods, response limits up to 10 MiB, and named credential slots. Only explicitly invoked actions and capability-backed transformers will be eligible. Detectors and both rendering surfaces are permanently offline. The future host broker will enforce redirects, timeouts, sizes, origin/method allowlists, and private-network denial. Credentials will remain in OS secure storage and be injected into approved requests without exposing their values to WASM. Until that broker ships, declarations are displayed and relevant contributions are marked unavailable while local contributions remain usable.

## Debugging and quarantine

Malformed output, forbidden effects, traps, deadline/fuel exhaustion, and oversized transfers are contribution failures. The UI falls back to core behavior. Repeated failures quarantine the package; recovery is explicit. Disabling or uninstalling an extension removes its disposable compact cache and shortcut assignments without changing canonical clipboard content.
