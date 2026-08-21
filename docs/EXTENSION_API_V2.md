# ClipsX Extension API v2

This replaces the pre-release v2 draft. Packages without `contractRevision = 2`
are rejected intentionally; there is no compatibility runtime.

## Package and lifecycle

A `.clipsx` ZIP contains `clipsx-extension.toml`, optional `component.wasm`, and
bounded assets below `icons/` and `ui/`. A release is identified by
`(packageId, version, archive checksum)`: package ID is stable identity, semantic
version describes the release, and checksum pins its exact bytes.

```toml
schemaVersion = 2
contractRevision = 2
packageId = "example.ask-ai"
version = "1.0.0"
apiVersion = "^2.0"
displayName = "Ask AI"

[[contributions]]
id = "ask-chatgpt"
kind = "action"
displayName = "Ask ChatGPT"
iconAsset = "icons/chatgpt.svg"
placements = ["preview_toolbar", "action_menu"]
effects = ["open_https_url"]
handler = { kind = "guest" }

[[contributions.matchers]]
mimeTypes = ["text/plain"]

[[permissions.externalNavigation]]
origin = "https://chatgpt.com"
```

Installed packages are enabled, disabled, quarantined, or incompatible.
Lifecycle never mutates canonical clips, facets, or saved output. Registry
updates are manual and review release/checksum/permission changes. Developer
Mode may replace a package ID for iteration. Updates, disablement, removal, and
developer replacement revoke checksum-bound external-data grants.

## Contributions and actions

Contribution kinds are detector, renderer, transformer, and action. WASM is
required only when guest logic is declared. Actions require `preview_toolbar`,
`action_menu`, or both; host UI controls overflow, pinning, and keyboard access.
Matchers establish applicability. The `action-state` guest export returns
`hidden`, `disabled(reason)`, or `enabled`; host constraints (provider support,
grant, input support, and session) can only downgrade that state and are checked
again immediately before execution.

Package SVGs live below `icons/`. Installation rejects active/external SVG
content including scripts, entities, event handlers, CSS URLs, foreignObject,
animation, embedded HTML, and references. Accepted icons are rendered as images,
not injected into the main DOM.

Actions may preview, copy, paste, save a new clip, open a declared URL, notify,
or open a declared dialog. They cannot update/delete clips, inspect arbitrary
history, or access filesystem, shell, database, or host clipboard APIs.

## Custom UI and broker

`uiEntry = "ui/index.html"` with `uiSurfaces = ["detail", "dialog"]` enables
locally bundled React, Vue, Svelte, or vanilla-JS UI. It runs in a dedicated
Tauri child webview with package-scoped assets, restrictive CSP, blocked
navigation/popups/downloads/direct network access, no inherited Tauri
capabilities, and teardown on deselection/close. Compact rows, toolbar chrome,
and permission prompts remain host-rendered.

The typed bridge exposes selected representation/facet, theme/locale/nonsecret
settings, declared actions/dialogs, and output submission. Navigation, HTTPS,
credentials, provider generation, settings, and outputs all pass through the
same host broker. HTTPS is exact-origin HTTPS only; redirects and
private/loopback/link-local/metadata destinations are denied. Secrets remain in
the OS credential store. `generation.text` is an abstract provider capability;
local Ollama support will be supplied by a host-owned adapter, never direct
localhost access from an extension.

The broker requires both a remembered checksum-bound grant and a short-lived
host-issued invocation token before selected clip data can leave ClipsX.

The current implementation exposes selected representation/facet context and
offline detail/dialog lifecycle. External-navigation actions already use
checksum grants and one-shot invocation tokens. The HTTPS broker policy and
request executor are implemented and tested, but guest adapters, credential
injection, nonsecret settings, output submission from custom UI, and
`generation.text` remain unavailable until their end-to-end authorization tests
land. Capability-backed contributions therefore report a disabled reason rather
than receiving partial access. See the [threat model](EXTENSION_THREAT_MODEL.md).

## Acceptance examples

`examples/extensions/ask-ai` demonstrates Unicode-safe URL encoding,
size-limited actions, SVG icons, declared navigation, and first-use consent.
`examples/extensions/mermaid-viewer` demonstrates offline detection, bundled
detail/dialog UI, source fallback, and no network permission.

Versioned installable archives and checksums are published in
[`examples/extensions/packages`](../examples/extensions/packages/README.md).
