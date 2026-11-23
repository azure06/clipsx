# Wasmtime cache dependency backport

Source: crates.io `wasmtime-internal-cache` 48.0.9, SHA-256
`5e6294e00c31bc4ad09b5354825cf32b08fbcfc19aaa49691fefe705ea088c82`.
The upstream source, tests and license are retained; its standalone lockfile is omitted.

The only upstream manifest change raises `zstd` from 0.13.0 to 0.14.3.
This selects the patched compression implementation without changing Wasmtime
48.0.9, extension contracts, or disabling the persistent compilation cache.

This addresses the dependency audit for RUSTSEC-2026-0391, RUSTSEC-2026-0398,
RUSTSEC-2026-0403 and RUSTSEC-2026-0410. The app lockfile pins the resolved
compression versions. No advisory suppression is used.

Remove this patch when an adopted upstream Wasmtime cache release uses the
patched compression dependency. Compare updates against the recorded archive.
