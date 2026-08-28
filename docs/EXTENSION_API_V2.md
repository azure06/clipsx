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
iconAssets = { light = "icons/package-light.svg", dark = "icons/package-dark.svg" }

[[contributions]]
id = "ask-chatgpt"
kind = "action"
displayName = "Ask ChatGPT"
iconAssets = { light = "icons/chatgpt-dark.svg", dark = "icons/chatgpt-light.svg" }
iconScale = 1.85
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
metadata is reviewed separately from package manifests and is snapshot when a
release is installed. Updates always show release/checksum/permission changes.
Safe automatic updates are opt-in: only enabled, ready registry packages may
move to a newer stable compatible release with an identical complete permission
set. Every other update remains reviewable and manual. Developer Mode may
replace a package ID for iteration but can never auto-update. Updates,
disablement, removal, and developer replacement revoke checksum-bound
external-data grants.

## Contributions and actions

Contribution kinds are detector, renderer, transformer, and action. WASM is
required only when guest logic is declared. Actions require `preview_toolbar`,
`action_menu`, or both; host UI controls overflow, pinning, and keyboard access.
Transformers appear only in the host Transform menu and always produce a
temporary result preview, unless the contribution sets `exposeInMenu = false`,
in which case it is invocable only as the backing operation of one or more
`transformer_preset` actions and never listed on its own. Actions never
appear in Transform: `preview_toolbar` requests a direct icon, while
`action_menu` places the action in the separate Actions menu. The host may move toolbar actions into Actions when direct space
is exhausted, and pinned actions remain available there for management.
Matchers establish applicability. The `action-state` guest export returns
`hidden`, `disabled(reason)`, or `enabled`; host constraints (provider support,
grant, input support, and session) can only downgrade that state and are checked
again immediately before execution.

Every contribution defaults to a 1 MiB representation-transfer ceiling.
`inputLimitBytes` may opt one contribution into a larger local transfer, up to
the host maximum of 10 MiB; the host enforces it before copying bytes into
WASM. Larger limits do not raise transform output, memory, fuel, or timeout
budgets. Prefer the smallest limit that covers the contribution's task.

Contextual actions match the complete clip rather than only the currently
visible renderer. The host prefers the active view's representation when it
matches; otherwise it binds the action to the highest-priority ready
representation accepted by its matcher. That bound representation is used
consistently for state evaluation, consent, invocation scope, and execution.

Package SVGs live below `icons/`. A top-level `iconAssets` pair identifies the
installed package. A contribution-level `iconAssets` pair identifies one view
or action and is selected by the host theme; use it for marks that require
contrast on both surfaces. The contribution-level single `iconAsset` remains a
theme-neutral fallback. Catalog icons are separate registry-owned, hashed,
bounded PNG/WebP assets because they must be verified and displayed before
download. Registry schema v3 declares each theme as `{ url, sha256 }`; the
client accepts only the official registry raw-content origin, verifies the
signed descriptor and downloaded bytes, and caches the raster by hash. Package
SVGs are never used as pre-install catalog content.

The exact registry `index.json` bytes are accompanied by a detached signature
document containing Ed25519 signatures and key IDs. Clients verify a signature
from an embedded trusted key before parsing or caching the index. Multiple
signatures support key overlap. A signed `revocations` entry contains
`packageId`, `version`, and archive `sha256`; matching registry releases are
blocked and existing installations are quarantined. Developer Mode archives
are explicitly unsigned and never receive registry updates.
`iconScale` may be set between `0.75` and `2` when a supplied asset contains
prescribed viewBox clear space; the host scales the image without cropping or
rewriting it.
Validated renderer icons are also exposed on preview-tab descriptors. When an
extension renderer is the host-resolved primary view, its icon may also be used
by the history row; alternate renderers never override that row independently.
Installation rejects active/external SVG
content including scripts, entities, event handlers, CSS URLs, foreignObject,
animation, embedded HTML, and external references. Static local fragment
references such as `url(#gradient)` are allowed. Accepted icons are rendered as
images, not injected into the main DOM.

Actions may preview, copy, paste, save a new clip, open a declared URL, notify,
open a declared dialog, or use the typed `compose_email` and `dial_phone` host
handlers. A typed native handler declares exactly one matching effect and a
bounded `facetValuePointer`; the host extracts that string from the action's
bound facet and validates it before constructing the OS request. It never
accepts an extension-provided URI. Typed native actions use local execution and
a short-lived invocation token but require no data-egress permission. They
cannot update/delete clips, inspect arbitrary
history, or access filesystem, shell, database, or host clipboard APIs.
Only an action output with the `preview` disposition opens a temporary result
tab. Copy, paste, save, navigation, notification, and dialog effects keep the
currently selected clip view active; failures are reported without creating an
empty result tab. Renderer detail views and declared dialogs are likewise never
listed as transforms. UTF-8 results use native text/code models; supported
raster results use a host-owned no-store URL into the expiring transform cache.
This is generic output presentation and does not transfer parsing or detection
ownership from the package to core.

## Custom UI and broker

`uiEntry = "ui/index.html"` with `uiSurfaces = ["detail", "dialog"]` enables
locally bundled React, Vue, Svelte, or vanilla-JS UI. It runs in a dedicated
Tauri child webview with package-scoped assets, restrictive CSP, blocked
navigation/popups/downloads/direct network access, no inherited Tauri
capabilities, and teardown on deselection/close. Compact rows, toolbar chrome,
and permission prompts remain host-rendered.

The host injects the scoped bridge at document start, before package scripts
run; packages do not load or bundle privileged SDK code. It exposes selected representation/facet, theme/locale/nonsecret
settings, `ready`, `https`, `openExternal`, `generateText`, `submitText`, and
`close`. A child view remains hidden behind host-rendered loading UI until it
calls `ready`; bootstrap/resource failures and loading timeouts produce a
recoverable host error instead of an empty native surface. Detail views do not
take focus merely by loading. When users intentionally focus a child view, its
unmodified keyboard input—including Arrow Up/Down and Home/End—belongs to that
view. Explicit dialogs receive focus after `ready` and return focus to the main
webview when closed.
`theme` is the currently applied `light` or `dark` theme (never an unresolved
`system` value), and `locale` is the active host locale. An open detail session
is recreated when either context value changes.

Custom detail renderers may declare `effects = ["copy"]`. Their UI can then
call `submitText("text/plain", value, "copy")`; ClipsX validates the declared
effect and performs the clipboard write through the host output boundary.
Renderers cannot request paste, save, navigation, provider, or other effects.
Without the declaration, output submission is rejected.

Settings are manifest-declared bounded `boolean`, `string`, or `number` values.
The host validates overrides, persists them in SQLite by stable package and
setting ID, and supplies the resolved object as `ClipsX.context.settings`.
Custom UI must not create a second source of truth in `localStorage`, IndexedDB,
or package files. Settings survive uninstall so a later reinstall restores
preferences; secrets instead use declared credential permissions and the OS
credential store.

Custom views must be fully offline, use the injected theme and locale, support
keyboard focus and reduced motion, and avoid shipping a framework where host
render models or small DOM code are sufficient. They call `ready` after the
first useful frame or an actionable error, not merely after HTML bootstrap.
Expensive parsing and rendering run in the isolated child view or WASM runtime,
away from the main ClipsX UI thread.

Only a host-rendered action can create a privileged dialog session; detail views
cannot invoke capabilities or mint dialog authorization. Navigation, HTTPS,
credentials, provider generation, settings, and outputs all pass through the
same Rust broker. HTTPS is exact-origin HTTPS only; redirects and
private/loopback/link-local/metadata destinations are denied. Secrets remain in
the OS credential store and may be injected only into a declared header for one
declared HTTP origin; secret values are never returned to UI or WASM.
`generation.text` is an abstract provider capability backed initially by the
host-owned Ollama adapter. Users configure endpoint and model in ClipsX;
extensions receive generated text but never localhost access or provider
configuration.

The broker requires both a remembered checksum-bound grant and a short-lived
host-issued invocation token before selected clip data can leave ClipsX.

The implementation registers normal application IPC behind explicit ACLs for the
primary webview. Tauri treats the app-registered package protocol as a local
origin; on Windows it exposes that protocol through an `http(s)://<protocol>.localhost`
URL. Only `extension-*` child labels receive the session-authenticated bridge
command, while package navigation remains locked to its unguessable session URL
in either URL representation.
Dialog-lifetime sessions are bound to package checksum, contribution, selected
clip/source, child label, and an unguessable token. HTTPS, external navigation,
credential injection, nonsecret settings, and bounded output submission are
implemented for explicit dialog actions and capability-backed WASM actions and
transformers. Output is cached through the normal
transform boundary before preview, copy, paste, or save-as-new-clip. The
`generation.text` contract reports an unavailable reason until a local provider
is configured. Parameter schemas generate host controls for bounded primitive
fields and are validated again before guest execution. See the
[threat model](EXTENSION_THREAT_MODEL.md).

## First-party packages and acceptance examples

First-party package sources live in
[`azure06/clipsx-extensions`](https://github.com/azure06/clipsx-extensions).
The host repository owns the API, runtime, package tooling, and conformance
tests; it does not vendor extension source or generated package archives.

`extensions/ask-ai` demonstrates clip-wide plain-text matching,
Unicode-safe URL encoding, size-limited actions, SVG icons, declared navigation,
and first-use consent.
`extensions/mermaid-viewer` is the first-party Mermaid package. It
demonstrates offline standalone Mermaid and Mermaid-in-Markdown detection, a
theme-native React/GFM detail and dialog UI, per-diagram navigation, accessible
source fallback, host-owned settings, and no network permission.
`extensions/communication-actions` demonstrates typed Compose and Dial
handlers without guest URI, network, shell, or filesystem access.
An enabled compatible renderer that claims an otherwise unknown facet on an
exact source representation suppresses the host's generic key/value details
tab. That generic tab returns automatically when the renderer is unavailable;
known built-in semantic renderers remain additive.
`extensions/ask-local-ai` demonstrates a capability-backed WASM action,
host-owned Ollama generation, dynamic action state, generated parameter controls,
and preview/copy/save output without exposing provider configuration.

The extension repository keeps package source and a pinned copy of the WIT
contract. Generated `component.wasm`, `.clipsx`, `target/`, and `dist/` outputs
are ignored. Versioned archives are immutable GitHub Release assets; the
separate registry contains their signed metadata and checksums.
