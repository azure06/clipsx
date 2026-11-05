# Wasmtime cache dependency backport

Source: crates.io `wasmtime-internal-cache` 48.0.8, SHA-256
`bc15ec65327e0dc659da1c15658e94a3d4ad3a2ed75a35a320c84af5984b13c2`.
The upstream source, tests and license are retained; its standalone lockfile is omitted.

The only upstream manifest change raises `zstd` from 0.13.0 to 0.14.3.
This selects the patched compression implementation without changing Wasmtime
48.0.8, extension contracts, or disabling the persistent compilation cache.

This addresses the dependency audit for RUSTSEC-2026-0391, RUSTSEC-2026-0398,
RUSTSEC-2026-0403 and RUSTSEC-2026-0410. The app lockfile pins the resolved
compression versions. No advisory suppression is used.

Remove this patch when an adopted upstream Wasmtime cache release uses the
patched compression dependency. Compare updates against the recorded archive.
