# Local clipboard MCP integration

The Integrations overview shows server status, the copyable endpoint, and named authorized assistants. Port configuration is under Advanced. Add assistant explains three steps: create named access, configure the external assistant, and test access to ClipsX. The form starts with Codex and read-only access; changing the setup template suggests a matching name while preserving a custom name. Codex, Claude Code, and generic setup templates do not restrict protocol compatibility. Creating a token does not configure the external app. Tokens appear only after creation or rotation and are discarded from the view on leaving it. Test access verifies authentication and tool discovery, not configuration inside the external client. Recent changes shows MCP mutations with assistant names; it is not a read-access audit log.

ClipsX exposes its shared Rust clipboard service through the official Rust MCP SDK's Streamable HTTP transport. Enable it in **Intelligence → Integrations**. It is disabled by default, binds only to `127.0.0.1`, and normally uses `http://127.0.0.1:39389/mcp`. The port is configurable. ClipsX must already be running; hiding its window keeps the server running. A port conflict changes integration status without stopping clipboard capture.

Applying an unchanged enabled configuration keeps existing client sessions connected. Changing the port or disabling the server closes its current sessions.

Create a named grant for each client. Grants default to read only; read/write also permits ordinary creation and organization. The creation or rotation response shows the token once. SQLite stores its SHA-256 verifier, never the raw token. Rotation and revocation cancel that client's sessions immediately. Disabling MCP cancels all sessions. Requests require `Authorization: Bearer <token>`; Host and supplied Origin headers must identify the configured loopback endpoint. Grants, endpoint settings and activity are device-local and excluded from sync and AI configuration exports.

**Revoke** disables a grant and retains its entry under Revoked access. **Delete assistant** removes an active or revoked grant and its verifier after inline confirmation, and disconnects its sessions. Deletion does not remove clips or retained activity; activity for a deleted grant uses the generic external-assistant label. Neither action edits the external app's configuration. To remove the Codex CLI server entry created by these instructions, run `codex mcp remove clipsx` separately; its environment variable remains under the user's control.

## Client setup

Set `CLIPSX_MCP_TOKEN` in the environment inherited by the client, using that client's grant. Keep the real token and completed setup commands out of shared project files. Direct assignment commands can remain in shell history.

### Codex CLI

Replace `PASTE_YOUR_TOKEN_HERE` with the token from ClipsX and run the command in the terminal used to launch Codex:

PowerShell:

```powershell
$env:CLIPSX_MCP_TOKEN = 'PASTE_YOUR_TOKEN_HERE'
```

Bash/Zsh:

```sh
export CLIPSX_MCP_TOKEN='PASTE_YOUR_TOKEN_HERE'
```

These values last for the terminal session. Register the server, then launch Codex from the same terminal:

```sh
codex mcp add clipsx --url http://127.0.0.1:39389/mcp --bearer-token-env-var CLIPSX_MCP_TOKEN
codex
```

If the CLI reuses a background server, that server must also have the updated environment. Restart it if necessary. Use `/mcp` inside Codex CLI to verify connection and tool discovery; a server in the configuration list is not proof of successful authentication.

### Codex desktop on Windows

The setup view defaults to **Desktop app (Windows)** on Windows. Replace `PASTE_YOUR_TOKEN_HERE` with the token from ClipsX, then run this in PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('CLIPSX_MCP_TOKEN', 'PASTE_YOUR_TOKEN_HERE', 'User')
```

Register the server with the `codex mcp add` command above, then fully quit and reopen Codex, including its background/tray process. Keep ClipsX running with MCP enabled. The app presents these three steps directly; environment details and connection checks live under **Not connecting?**.

The token is stored in Windows user environment settings, outside the encrypted credential vault. Future processes inherit it; this command does not set the current terminal's process variable. The desktop app and CLI [share MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) when they use the same Codex home and execution host; registration requires the CLI to be installed.

Keep ClipsX running with MCP enabled. Fully quit the Codex desktop app, including background/tray processes, and reopen it. Reopening a chat alone does not refresh the app's environment. If the launching process still carries an older environment, sign out of Windows and back in before reopening Codex. Check the client's MCP settings for connection errors. A subprocess environment check is not authoritative for the parent app because Codex can filter variables passed to shell commands.

When removing a persistent token, remove the Windows user value explicitly with `[Environment]::SetEnvironmentVariable('CLIPSX_MCP_TOKEN', $null, 'User')`, then restart affected clients. `codex mcp remove clipsx` removes configuration, not this environment value. Other operating systems need environment setup appropriate to their desktop launcher; setting a shell variable alone does not update a running desktop app.

### Finding a saved token

The Codex setup view includes copyable commands to inspect a saved token. CLI mode shows `$env:CLIPSX_MCP_TOKEN` for PowerShell or `printenv CLIPSX_MCP_TOKEN` for Bash/Zsh. These show the terminal's environment. Windows desktop mode shows `[Environment]::GetEnvironmentVariable('CLIPSX_MCP_TOKEN', 'User')`, which reads the saved user value. Neither inspects an already-running Codex process. An empty result means the value is unset or empty in the inspected location. If the token was lost, rotate it in the assistant's access page, replace the environment value, and restart the client. Rotation disconnects existing sessions. ClipsX cannot recover the original from its verifier.

### Other clients

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

Use **Test access** with the client's token to perform initialization and tool discovery. It does not call a model or change clips, and does not verify the external client's environment or configuration. Restart the client if its environment or endpoint changes. Rotation requires replacing that client's token.

## Tools and limits

The tools are `get_clipboard_status`, `list_clipboard_filters`, `search_clips`, `read_clip`, `read_clip_image`, `create_clip`, `organize_clips`, and `undo_clipboard_action`. Read-only grants discover the first five. Tool input and structured output schemas derive from the same Rust DTOs as native Recall. Image results carry standard MCP image content with structured dimension/source metadata; image bytes are not duplicated in metadata.

Keyword retrieval needs no model. Hybrid retrieval uses the active embedding configuration and retains keyword results on semantic failure. Queries may filter by capture time, source application, tags, scope, representation family and facets, or exclude explicit clip IDs. Empty queries browse recent eligible clips. Results default to 20 and are capped at 50. Text pages default to 8 KiB and are capped at 32 KiB with UTF-8 boundaries and revision-bound cursors. Existing OCR is available without starting a job. Managed PNG/JPEG previews are hash-verified, decoded with allocation limits, capped at a 2,048-pixel longest edge and 4 MiB encoded image content. File-list clips grant no access to external paths.

### Retrieval guidance for external assistants

Server initialization supplies a retrieval policy; tool discovery supplies call-specific descriptions, parameter guidance, and schema examples. No separately installed ClipsX skill is required. The client/model decides when to call tools; instructions guide that decision rather than forcing calls on every message.

Consider retrieval on each request when saved clipboard context could materially help: something copied or saved, an earlier reading, vague recollections, or previous work. The user need not name ClipsX. Skip unrelated general questions and tasks already answered by supplied context. Retrieve relevant context rather than browsing unrelated history. Copied content is not evidence of the user's personal beliefs or preferences.

| Request | Call strategy |
| --- | --- |
| Vague memory, topic, or paraphrase | Check readiness when needed; explicitly choose `mode: "hybrid"` if `semanticReady`, using a concise description of the remembered concept. |
| Distinctive name, code, identifier, or URL | Use `mode: "keyword"` with a few distinctive terms. |
| Semantic retrieval unavailable | Use short keyword alternatives in separate calls and report the limitation when it matters. |
| Recent or pinned material without remembered wording | Use `query: ""` with relevant known filters; browse only as needed for the request. |
| Weak or ambiguous results | Try synonyms, fewer distinctive terms, or another aspect of the memory; read plausible hits and ask for a distinguishing clue if ambiguity remains. |

Keyword search uses literal prefix terms joined by AND, not exact-phrase or Boolean syntax. A full natural-language question can overconstrain it; `OR` is not an alternative-query operator. Hybrid combines keyword and meaning retrieval, so it can find related wording without lexical overlap when an indexed semantic source is available. The API's omitted-mode default remains keyword for compatibility; assistants must explicitly select hybrid for these memory tasks.

Representative `search_clips` calls:

```json
{"query":"prevent database outages from exhausted connection pools","mode":"hybrid","limit":10}
```

```json
{"query":"ERR_CONNECTION_RESET","mode":"keyword","limit":10}
```

```json
{"query":"","mode":"keyword","filters":{"scope":"pinned"},"limit":10}
```

Use actual IDs from `list_clipboard_filters` when filters need them. Capture-date bounds are inclusive Unix milliseconds and refer to when content was copied; use the status time/timezone for relative dates. Preserve explicit user constraints, and do not turn uncertain clues into hard exclusions. Follow `nextCursor` with the same query, mode, and filters; start without a cursor when reformulating.

Search results are leads. Read relevant candidates with `read_clip` before quoting, summarizing, or using them to answer. Read images only when relevant and advertised as available. Stop when there is enough evidence or after a few targeted attempts; ranks are not confidence, and incomplete or unavailable sources do not establish absence. Distinguish inspected evidence, uncertain matches, and the assistant's inference. Retrieval alone never authorizes creation, organization, or undo.

Protocol tests validate delivery of server instructions and schema examples against the call contract. Whether a particular model follows the retrieval strategy needs a model-assisted client check; reconnecting clients is required to receive changed discovery metadata.

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
