# Release Notes

## v0.1.0 Scope

- Ship macOS, Windows, and Linux from the `main` branch.
- Keep OCR enabled as part of the shipped baseline.
- Keep the in-app updater enabled for release builds.
- Do not expose direct OpenAI/Claude "Privacy Mode" until the backend exists.

## Required Secrets

- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

These are required for updater-enabled release builds.

## Platform Notes

- **Windows:** build in CI, then code-sign the public artifact on the Windows release laptop before publishing the release.
- **macOS:** v0.1.0 uses ad-hoc signing (`signingIdentity: "-"`). Users may need to allow the app manually in Privacy & Security on first launch.
- **Linux:** publish the generated `.deb` and `.AppImage` artifacts directly.

## Smoke Test Checklist

- Install the built artifact on each target OS.
- Launch once and confirm tray, global shortcut, and clipboard capture work.
- Copy an image and confirm OCR finishes and becomes searchable.
- Trigger an update check and confirm the update UI appears when a newer release exists.
- Install the update and confirm the app restarts into the new version.
