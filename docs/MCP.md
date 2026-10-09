# Local clipboard MCP integration

ClipsX exposes its shared Rust clipboard service through the official Rust MCP SDK's Streamable HTTP transport. Enable it in **Intelligence → Integrations**. It is disabled by default, binds only to `127.0.0.1`, and normally uses `http://127.0.0.1:39389/mcp`. The port is configurable. ClipsX must already be running; hiding its window keeps the server running. A port conflict changes integration status without stopping clipboard capture.

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
