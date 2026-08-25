# Extension threat model

Extension packages are untrusted input. This model covers package installation,
WASM execution, custom detail/dialog UI, broker requests, lifecycle, and output.
It does not treat registry review or package authorship as a security boundary.

## Assets and trust boundaries

The protected assets are canonical clips, arbitrary clipboard history, managed
files, the database, OS credentials, provider configuration, filesystem/shell
access, network identity, and the privileged primary webview. The Rust host,
platform clipboard adapters, OS credential store, and primary webview are
trusted. Package archives, WASM components, SVGs, custom UI, registry metadata,
remote responses, and extension outputs are untrusted.

The official registry index is trusted only after an Ed25519 signature over its
exact bytes verifies against an embedded key ID. Parsing, cache replacement,
icon fetches, and installation occur after that gate. Catalog raster bytes are
still untrusted input: their origin, byte limit, file signature, and signed
SHA-256 are checked independently. A verified revocation disables and
quarantines an exact registry package ID/version/checksum tuple; recovery cannot
override it. Registry trust does not apply to Developer Mode archives.

```text
untrusted package -> installer/validator -> app-owned package files
       WASM guest -> bounded runtime -> typed outputs
        UI guest  -> isolated child webview -> session bridge
invoked operation -> grant + scoped token -> host broker -> allowed destination
```

## Required security properties

- A package cannot read another clip, package, setting, secret, or UI session.
- Extension views cannot invoke application commands or inherit main-webview
  Tauri capabilities. Navigation, popups, downloads, storage, and direct network
  paths remain unavailable.
- Clip data cannot leave ClipsX without an exact-checksum remembered grant and a
  short-lived host-issued token scoped to package, contribution, clip, source,
  facet, and invocation/view lifetime.
- HTTPS requests match declared origin, path, method, timeout, and byte limits;
  redirects and private, loopback, link-local, multicast, unspecified, and
  metadata-network destinations are denied after DNS resolution.
- Credentials are never returned to a guest. The Rust broker injects a value
  only into its declared safe header and exact declared HTTP origin.
- Outputs are bounded new values. They cannot mutate/delete the selected clip,
  inspect history, or directly own clipboard writes.
- A custom detail renderer can request a bounded text copy only when its
  manifest declares the `copy` effect. The host validates that declaration and
  performs the write; the child webview never receives a clipboard capability.
- Typed Compose/Dial actions extract a bounded value from the already-bound
  facet, validate it in Rust, and construct only `mailto:` or `tel:` requests.
  The package never supplies a scheme or receives generic URI/shell access.
- Updating, disabling, replacing, uninstalling, or changing package bytes ends
  sessions and revokes checksum-bound grants.

## Principal threats and controls

| Threat                            | Primary controls                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious archive/path traversal  | bounded ZIP parsing, path normalization, duplicate/size rejection, app-owned install root                                                                                   |
| Active SVG/HTML payload           | strict SVG rejection/canonicalization, image rendering, package protocol CSP                                                                                                |
| WASM escape or denial of service  | Component Model validation, empty ambient linker, memory/table/fuel/epoch/time limits, quarantine                                                                           |
| Child-view privilege escalation   | unique `extension-*` labels, global Rust invoke gate, main-only capability file, no global Tauri API                                                                        |
| Network or popup bypass           | `connect-src 'none'`, navigation allowlist, popup and download denial, incognito child views                                                                                |
| Token/session spoofing            | random session/token values plus package/contribution/clip/source/facet binding and expiry                                                                                  |
| SSRF/DNS rebinding/redirect abuse | HTTPS-only exact origin/path/method policy, resolved-address filtering/pinning, redirects disabled                                                                          |
| Secret disclosure                 | OS credential store, broker-only injection, response/log redaction requirement                                                                                              |
| Canonical history corruption      | output-only dispositions and host-owned copy/paste/save paths                                                                                                               |
| Native-handler capability creep   | exact `compose_email`/`dial_phone` variants, bound-facet JSON Pointer, host validation, scoped invocation token, no caller-supplied URI                                      |
| Malicious update retaining trust  | opt-in safe updates only for stable, compatible, permission-identical releases; checksum verification, grant/session invalidation, and manual review for every other update |

## Residual risk and release gates

Custom UI depends on platform webview behavior. Windows, macOS, and Linux/X11
installed builds must verify IPC denial, CSP, navigation, popup/download denial,
focus, sizing, accessibility, teardown, and crash recovery. The dialog HTTPS
bridge is exposed only behind checksum grants, host-created dialog authorization,
child-label/session binding, bounded responses, and credential isolation. Release
certification must additionally exercise cancellation and malicious bridge messages
in installed builds.
`generation.text` remains unavailable until a host-owned provider adapter meets
the same invocation and data-egress rules.
