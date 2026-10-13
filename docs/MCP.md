# Local clipboard MCP integration

The Integrations overview shows server status, the copyable endpoint, and named authorized assistants. Port configuration is under Advanced. Add assistant and Manage use dedicated page views with Codex, Claude Code, or generic setup templates; templates do not restrict protocol compatibility. Tokens appear only after creation or rotation and are discarded from the view on leaving it. Test access verifies authentication and tool discovery, not configuration inside the external client. Recent changes shows MCP mutations with assistant names; it is not a read-access audit log.

ClipsX exposes its shared Rust clipboard service through the official Rust MCP SDK's Streamable HTTP transport. Enable it in **Intelligence → Integrations**. It is disabled by default, binds only to `127.0.0.1`, and normally uses `http://127.0.0.1:39389/mcp`. The port is configurable. ClipsX must already be running; hiding its window keeps the server running. A port conflict changes integration status without stopping clipboard capture.

Applying an unchanged enabled configuration keeps existing client sessions connected. Changing the port or disabling the server closes its current sessions.

Create a named grant for each client. Grants default to read only; read/write also permits ordinary creation and organization. The creation or rotation response shows the token once. SQLite stores its SHA-256 verifier, never the raw token. Rotation and revocation cancel that client's sessions immediately. Disabling MCP cancels all sessions. Requests require `Authorization: Bearer <token>`; Host and supplied Origin headers must identify the configured loopback endpoint. Grants, endpoint settings and activity are device-local and excluded from sync and AI configuration exports.

## Client setup

Set `CLIPSX_MCP_TOKEN` in the environment inherited by the client, using that client's grant. Keep the real token out of shared project files and command history.

For Codex CLI:

```sh
codex mcp add clipsx --url http://127.0.0.1:39389/mcp --bearer-token-env-var CLIPSX_MCP_TOKEN
```

For Claude Code, merge this entry into `.mcp.json`:

```json
{
  "mcpServers": {
    "clipsx": {
      "type": "http",
      "url": "http://127.0.0.1:39389/mcp",
      "headers": { "Authorization": "Bearer ${CLIPSX_MCP_TOKEN}" }
    }
  }
}
```

Claude Code documents [HTTP headers and environment interpolation](https://code.claude.com/docs/en/agent-sdk/mcp). Other compatible clients use the same URL, Streamable HTTP transport, and bearer header. Cloud-hosted clients need a supported local bridge or tunnel to reach this endpoint. ClipsX does not create a public tunnel.

Use **Test connection** with the client's token to perform initialization and tool discovery. It does not call a model or change clips. Restart the client if its environment or endpoint changes. Rotation requires replacing that client's token.

## Tools and limits

The tools are `get_clipboard_status`, `list_clipboard_filters`, `search_clips`, `read_clip`, `read_clip_image`, `create_clip`, `organize_clips`, and `undo_clipboard_action`. Read-only grants discover the first five. Tool input and structured output schemas derive from the same Rust DTOs as native Recall. Image results carry standard MCP image content with structured dimension/source metadata; image bytes are not duplicated in metadata.

Keyword retrieval needs no model. Hybrid retrieval uses the active embedding configuration and retains keyword results on semantic failure. Queries may filter by capture time, source application, tags, scope, representation family and facets, or exclude explicit clip IDs. Empty queries browse recent eligible clips. Results default to 20 and are capped at 50. Text pages default to 8 KiB and are capped at 32 KiB with UTF-8 boundaries and revision-bound cursors. Existing OCR is available without starting a job. Managed PNG/JPEG previews are hash-verified, decoded with allocation limits, capped at a 2,048-pixel longest edge and 4 MiB encoded image content. File-list clips grant no access to external paths.

All assistant access excludes secret-faceted clips, including direct-ID reads and writes. Clipboard text and OCR are evidence, never instructions. Tools expose no SQL, database handles, shell, arbitrary filesystem access, provider credentials, network bridge, history deletion or history wipe.

Writes require stable UUID request IDs; organization also requires current revision tokens and at most 50 explicit clip IDs. Whole-batch validation, mutation, provenance, action record and indexing intent commit atomically. Retries return recorded results for 30 days, while changed arguments conflict. Generated clips appear in History and do not replace the system clipboard. Transformations preserve originals. Undo restores organization or deletes an unchanged generated clip; it refuses later edits and cannot undo another client's action. A cancelled request may already have committed its write; retry using the same request ID.

Each client owns a separate session service. Up to 64 active grants, 16 legacy sessions per client, 16 concurrent HTTP streams, and four concurrent reads per client are supported. Mutations serialize across external clients. HTTP bodies are capped at 1 MiB and response streams at 32 MiB. Newer stateless MCP requests remain authenticated by the same grant. Operational failures return curated host failure categories rather than raw provider or database errors.

The protocol suite exercises discovery, reads, images, writes, idempotency, session isolation, rotation/revocation, port failure, and shutdown over real loopback HTTP. A fixture pass does not establish a live model or external-client compatibility pass; those require the corresponding installed and configured client.

The installed Codex client can be checked independently of model inference. Set `CLIPSX_CODEX_BINARY` to its executable and run `npm run test:rust -- recall::mcp_tests::codex_client_workflows -- --ignored --exact --nocapture`. The test starts the actual client app-server in an isolated temporary profile and calls its MCP discovery/tool APIs against synthetic ClipsX data. It checks read-only/write catalogs, search, text/image reads, secret exclusion, creation retries, organization, and undo. It starts no model turn and does not alter the user’s Codex configuration. Claude Code requires a separate client verification.

## Claude Code verification

Claude Code verification is separate from the loopback protocol suite and Codex app-server check. Use an explicitly selected installed Claude Code executable and an isolated temporary working directory/configuration with synthetic ClipsX data. Authentication must already be available; do not copy credentials into fixtures or change permanent client configuration.

1. Configure separate read-only and read/write client grants. Verify both clients connect and discover exactly their permitted tools.
2. Ask the read-only client to search a unique synthetic phrase, read its text with pagination, and inspect a synthetic PNG. Check the actual tool results and citations; a natural-language success claim is insufficient.
3. Confirm secret-faceted clip IDs cannot be read and read-only grants cannot create or organize clips.
4. With the write client, create a synthetic clip using a stable request ID, retry it, and verify one clip/action was created. Organize with current revisions, undo, and inspect the actual restored state.
5. Rotate/revoke a grant while connected and verify existing sessions lose access. Disable MCP and verify connection failure without interrupting capture.
6. Record the client version, tested commit, actual calls and results. Mark unavailable clients, authentication, or unexercised workflows pending. Model-assisted tests consume inference and are distinct from protocol-only tests.

ClipsX bounds tool payloads; each external client owns its context management and compaction. Native Recall summaries are never injected into external MCP sessions.
