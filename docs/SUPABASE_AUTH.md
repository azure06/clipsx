# Desktop Supabase authentication

ClipsX supports optional, browser-based Supabase login. Authentication is independent of clipboard history: ClipsX does not sync, upload, or use account status to gate local features.

## Desktop build configuration

Provide these public build-time values to the desktop build environment. Do not commit real project values to the repository.

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_SUPABASE_AUTH_PROVIDER=github
```

`VITE_SUPABASE_AUTH_PROVIDER` is optional and defaults to `github`. It uses Supabase's provider names, so a later enabled provider can be selected without changing the desktop UI. Builds without the URL or publishable key simply show that account sign-in is unavailable.

Never put a Supabase `service_role` key in a desktop build. The publishable key is intentionally public; service-role keys bypass Row Level Security and belong only in trusted server environments.

## Supabase and provider setup

1. In the Supabase dashboard, configure the chosen social provider under **Authentication → Providers**.
2. In the provider's developer console, set the OAuth callback URL to the Supabase callback for the project:

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   Use the exact callback URL shown by the Supabase provider setup screen if it differs.
3. Under **Authentication → URL Configuration**, add this exact Redirect URL:

   ```text
   clipsx://auth/callback
   ```

   Keep any production website URLs separate and explicit; do not use a broad redirect wildcard.

The desktop app requests the Supabase PKCE flow, opens the returned authorization URL in the system browser, and exchanges the short-lived callback code locally. Codes are one-time and expire quickly, so a duplicate or old callback is safely rejected.

## Deep-link registration and testing

The Tauri config registers the `clipsx` desktop scheme through `tauri-plugin-deep-link`. On Windows and Linux, `tauri-plugin-single-instance` forwards a deep link to an existing ClipsX process; on macOS, the OS delivers it to the running app.

Test each packaged target, not only a browser build:

1. Start ClipsX, choose **Settings → Account → Sign in in your browser**, and complete the provider login.
2. Verify the browser returns to the already-open app and the Account panel shows the signed-in address.
3. Quit ClipsX, repeat the flow, and verify a `clipsx://auth/callback?...` launch completes sign-in after startup.
4. Test cancel, an altered callback path, and re-opening the same callback. Each must fail without creating a session.
5. Sign out and restart; no account should be restored.

During development, protocol registration behavior varies by platform. Use a packaged application for final Windows, macOS, and Linux verification.

## Future website integration

A future website can use the same Supabase project and its own approved HTTPS redirect URLs. It must run its own browser PKCE/session flow. The website must not receive, relay, or attempt to reuse a ClipsX callback code, PKCE verifier, or desktop session token.

## Security boundary

Session and PKCE data are stored only through the operating system credential vault adapter. They are not written to Zustand persistence, normal app settings, clipboard history, diagnostics, or logs. Login has no database schema, RLS, cloud-sync, entitlement, OCR, search-index, or AI-asset behavior in ClipsX.
