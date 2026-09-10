<p align="center">
  <img src="public/clips.svg" width="88" alt="ClipsX logo" />
</p>

# ClipsX

## Introduction

ClipsX is a programmable desktop clipboard. It captures the things that pass
through your clipboard - text, images, files, rich content, tables, and links -
and keeps their useful representations together.

The application can render a clip in the form that makes sense, find it again
with text or optional semantic search, transform it deliberately, and copy or
paste a format the platform explicitly supports. Canonical captures stay
separate from derived previews, OCR, search indexes, embeddings, and generated
output.

```text
Capture -> Understand -> Render / Transform -> Copy or Paste
```

## Getting Started

ClipsX is pre-release software and currently runs from source. Install Node.js,
Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your platform, then run:

```bash
git clone https://github.com/azure06/clipsx.git
cd clipsx
npm install
npm run tauri:dev
```

`npm run tauri:dev` and `npm run tauri:build` require `VITE_SUPABASE_URL` so
the generated content-security policy can allow the configured authentication
origin. The [release guide](docs/RELEASE.md) covers distributable-build
requirements.

## Features

ClipsX includes, but is not limited to:

- Clipboard history for supported text, HTML, RTF, images, files, PDFs, and
  Office alternates.
- Format-aware views for Markdown, JSON, dates, tables, URLs, colors, images,
  files, and rich text.
- Pins, favorites, notes, tags, and keyboard-friendly navigation.
- Full-text search and optional semantic search for finding a clip by meaning.
- OCR where the platform provider is available.
- Faithful output where the platform supports reconstruction, alongside a
  plain-text output when that is what you need.
- Sandboxed WebAssembly extensions for focused detectors, renderers,
  transformations, and contextual actions.

### Platforms

ClipsX is intended for the following desktop platforms. Native validation,
packaging, and signing are still in progress.

| Platform | Status |
| :------- | :----- |
| Windows  | Targeted for the first release |
| macOS    | Targeted for the first release |
| Linux    | X11 targeted for the first release |

See the [roadmap](docs/ROADMAP.md) for the current certification and packaging
work.

## Contributing

Before starting a substantial change, check for an existing issue and read the
[Contributing Guide](CONTRIBUTING.md). It covers the development setup, checks,
and system boundaries that keep ClipsX reliable.

Thank you to everyone who spends time making the project clearer, safer, or
more useful.

### Documentation

ClipsX has a native host, a React interface, platform-specific clipboard
adapters, and a persistence model that distinguishes original captures from
derived data. The maintained documentation describes those boundaries:

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/MODELS.md)
- [Semantic search architecture](docs/SEMANTIC_SEARCH_ARCHITECTURE.md)
- [Extension API v2](docs/EXTENSION_API_V2.md)
- [Roadmap](docs/ROADMAP.md)

## Organization

ClipsX is currently maintained as an independent project. This repository owns
the desktop host, public extension contract, package CLI, and conformance tests.
First-party extension sources and the reviewed extension catalog are maintained
separately from the host and its canonical clipboard data.

## License

ClipsX is preparing for an open-source release, but the final license has not
yet been selected. Until one is added, this repository is not licensed for
redistribution or reuse. See [LICENSE](LICENSE) for the current notice.
