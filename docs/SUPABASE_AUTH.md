# Desktop Supabase authentication

ClipsX supports optional, browser-based Supabase login. Authentication is independent of clipboard history: ClipsX does not sync, upload, or use account status to gate local features.

## Desktop build configuration

Provide these public build-time values to the desktop build environment. Do not commit real project values to the repository.

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_CLIPSX_WEB_ORIGIN=https://clipsx.app
VITE_SUPABASE_AUTH_PROVIDER=google
```

`VITE_CLIPSX_WEB_ORIGIN` is optional and defaults to `https://clipsx.app`. It must be an HTTPS origin, except local builds may use a loopback HTTP origin such as `http://localhost:3000`. `VITE_SUPABASE_AUTH_PROVIDER` is optional and defaults to `google`; this first desktop browser flow supports Google only. Builds without the URL or publishable key simply show that account sign-in is unavailable.

`npm run tauri:dev` and `npm run tauri:build` generate an ignored `src-tauri/tauri.auth.csp.conf.json` from `VITE_SUPABASE_URL`. It permits the exact configured Supabase origin in Tauri's `connect-src`; it never uses a `*.supabase.co` wildcard. Keep these values in an ignored local or CI environment file.

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
   https://clipsx.app/auth/callback
   https://clipsx.app/auth/desktop/callback
   ```

   For local desktop development, also add `http://localhost:3000/auth/desktop/callback`. Keep any production website URLs separate and explicit; do not use a broad redirect wildcard. The website callback bridge must be deployed before releasing a desktop build.

The desktop app requests the Supabase PKCE flow, opens the returned authorization URL in the system browser, and sets its redirect to `https://clipsx.app/auth/desktop/callback`. The website bridge forwards only the unexchanged short-lived code (or provider error) to the fixed `clipsx://auth/callback` deep link. The desktop then exchanges that code locally using its original PKCE verifier. Codes are one-time and expire quickly, so a duplicate or old callback is safely rejected.

## Deep-link registration and testing

The Tauri config registers the `clipsx` desktop scheme through `tauri-plugin-deep-link`. On Windows and Linux, `tauri-plugin-single-instance` forwards a deep link to an existing ClipsX process; on macOS, the OS delivers it to the running app.

Test each packaged target, not only a browser build:

1. Start ClipsX, choose **Settings → Account → Sign in in your browser**, and complete the provider login.
2. Verify the browser returns to the already-open app and the Account panel shows the signed-in address.
3. Quit ClipsX, repeat the flow, and verify a `clipsx://auth/callback?...` launch completes sign-in after startup.
4. Test cancel, an altered callback path, and re-opening the same callback. Each must fail without creating a session.
5. Sign out and restart; no account should be restored.

During development, protocol registration behavior varies by platform. Use a packaged application for final Windows, macOS, and Linux verification.

## Website callback bridge

The website uses its own approved HTTPS redirect URLs for normal web sessions. For desktop login, `/auth/desktop/callback` is deliberately a small relay: it must not call `exchangeCodeForSession`, set website auth cookies, receive the PKCE verifier, or accept an arbitrary final destination. It forwards only the allowed callback values to the fixed `clipsx://auth/callback` scheme.

## Security boundary

Session and PKCE data are stored only through the operating system credential vault adapter. They are not written to Zustand persistence, normal app settings, clipboard history, diagnostics, or logs.

Authentication alone does not upload clipboard history and never grants access
to another user's cloud rows. Future Pro services use explicit entitlements,
collection membership, and Row Level Security in addition to authentication.
The end-to-end encryption and deliberate-upload boundary are documented in
[CLOUD_SECURITY.md](./CLOUD_SECURITY.md).
