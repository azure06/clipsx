<p align="center">
  <img src="public/clips.svg" width="88" alt="ClipsX logo" />
</p>

# ClipsX

**Copy something. Do more with it.**

Free, open source clipboard manager for Windows, macOS and Linux. Search your history by meaning, let Claude Code or Codex search it too, and keep everything on your device.

Free · No account · Local-first · Apache-2.0

[Star ClipsX on GitHub](https://github.com/azure06/clipsx) · [Download the latest release](https://github.com/azure06/clipsx/releases/latest) · [clipsx.app](https://clipsx.app) · [Documentation](https://docs.clipsx.app)

## What it does

- Clipboard history for text, HTML, RTF, images, files, PDFs and Office alternates, kept on your device.
- Find a clip by meaning, not just by exact words. Meaning Search is optional semantic search with a local Ollama embedding model you choose. There is no default model: you pick a named embedding preset from the Ollama catalog.
- Ask Recall questions about your history, with answers traced back to the source clips.
- Rewrite a copied message with local AI.
- Format aware views: Markdown, JSON, dates, tables, URLs, colours, images, files and rich text.
- Pins, favourites, notes, tags and keyboard friendly navigation. OCR where the platform provider is available.
- Sandboxed WebAssembly extensions (Mermaid, JWT Inspector, Base64, Data Tools, Ask AI, Rewrite).

## Claude Code and Codex can search your clipboard (MCP)

ClipsX runs an MCP server that AI tools can query. It is disabled by default. Enable it under Intelligence, then Integrations. It runs on loopback only (`http://127.0.0.1:39389/mcp`) with a per assistant bearer token.

There are 8 tools. The read tools are `get_clipboard_status`, `list_clipboard_filters`, `search_clips`, `read_clip` and `read_clip_image`. The write tools are `create_clip`, `organize_clips` and `undo_clipboard_action`. Read only is the default grant. The write tools need a read and write grant.

Claude Code, add to your MCP config (with `CLIPSX_MCP_TOKEN` set):

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

Codex CLI:

```text
codex mcp add clipsx --url http://127.0.0.1:39389/mcp --bearer-token-env-var CLIPSX_MCP_TOKEN
```

## ClipsX vs the others

| | ClipsX | Maccy | CopyQ | Ditto | EcoPaste |
|---|---|---|---|---|---|
| Platforms | Windows / Mac / Linux | Mac only | Windows / Mac / Linux | Windows only | Windows / Mac |
| Price and licence | Free, Apache-2.0 | Free, MIT | Free, GPL-3.0 | Free, GPL-3.0 | Free, Apache-2.0 |
| Search by meaning (local AI) | Yes (Ollama) | No | No | No | No (full text search) |
| MCP for Claude Code and Codex | Yes, read only by default | No | No | No | No |
| GitHub stars, Nov 19 2026 | 1 | 22,385 | 12,670 | 7,506 | 7,594 |

Where ClipsX loses, honestly: no iPhone app, no cloud sync, and Linux is X11 only, with Wayland out of scope. It is also a young project, started in February 2026. Saying this plainly is what makes the rest of the table worth trusting.

## Install

Download installers from the [latest release](https://github.com/azure06/clipsx/releases/latest): Windows x64 installer, macOS Apple Silicon and Intel .dmg, Linux x64 AppImage and .deb (X11).

There is no Homebrew, winget, Chocolatey or Scoop package yet, so there is no one line install command to copy here.

## Platforms

Published targets are Windows x64, macOS Apple Silicon and Intel, and Linux/X11 x64 (AppImage and .deb). Wayland is outside the advertised targets. Consult the selected release notes for verified capabilities and limitations.

## For developers

The app itself needs no account and no Supabase. The setup below is for contributors only.

Install Node.js, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform, then run:

```bash
git clone https://github.com/azure06/clipsx.git
cd clipsx
npm install
npm run tauri:dev
```

`npm run tauri:dev` and `npm run tauri:build` require `VITE_SUPABASE_URL` so the generated content security policy can allow the configured authentication origin. The [release guide](.agents/skills/clipsx-release/references/operations.md) covers distributable build requirements.

See [Snap packaging instructions](assets/snap/README.md) for experimental Linux packaging.

To run a development binary against production services, populate the ignored `.env` with the public Supabase URL and publishable key and the reviewed website origin, then run:

```bash
npm run tauri:dev:production
```

This command rejects loopback origins and Supabase secret or service role keys. It still uses the Vite development server. To build a release mode executable with the production frontend embedded and no local web server, run `npm run tauri:build:production:smoke`. The executable is written to `src-tauri/target/release/clipsx.exe`. Use `npm run tauri:build:production` only when installer bundles are also required. None of these commands changes `.env.local`. Normal development and tests continue to use the local environment.

### App information

Settings, then About, shows the installed version, source commit, local modifications, operating system, architecture and build type. Copy app info copies these details for bug reports. Update checks, installation and restart actions are also available there. Diagnostics remain in Settings, then Advanced.

Native builds embed source identity independently of telemetry. `CLIPSX_BUILD_COMMIT` overrides `GITHUB_SHA`, followed by the checkout Git revision. Git supplies working tree status when available. Source archives without Git show unavailable metadata. Changes to Git metadata and source files refresh build identity while preserving incremental builds.

## Contributing

Before starting a substantial change, check for an existing issue and read the [Contributing Guide](CONTRIBUTING.md). It covers the development setup, checks, and system boundaries that keep ClipsX reliable.

Community participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). For questions and bug reports, see [support resources](SUPPORT.md). Report vulnerabilities privately using the [security policy](SECURITY.md).

Thank you to everyone who spends time making the project clearer, safer, or more useful.

### Documentation

ClipsX has a native host, a React interface, platform specific clipboard adapters, and a persistence model that distinguishes original captures from derived data. The maintained documentation describes those boundaries:

- [Data model](docs/MODELS.md)
- [Semantic search architecture](docs/SEMANTIC_SEARCH_ARCHITECTURE.md)
- [Extension API v3](docs/EXTENSION_API_V3.md)
- [Release operations](.agents/skills/clipsx-release/references/operations.md)

## Organization

ClipsX is currently maintained as an independent project. This repository owns the desktop host, public extension contract, package CLI, and conformance tests. First party extension sources and the reviewed extension catalog are maintained separately from the host and its canonical clipboard data.

## License

ClipsX is licensed under the [Apache License 2.0](LICENSE). The license covers the desktop repository. The hosted website and third party packages retain their own terms.

If ClipsX saves you time, a star helps other people find it: https://github.com/azure06/clipsx
