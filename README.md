# ClipsX - Clipboard Manager

See [Architecture](docs/ARCHITECTURE.md) for the system design and data flows,
and the [Architecture Execution Plan](docs/ARCHITECTURE_EXECUTION_PLAN.md) for
delivery milestones.

> **Fast, privacy-first clipboard history with semantic search**

Built with Tauri 2.x + React 19 + Rust + TypeScript

---

## 📖 Documentation

- **[README.md](./README.md)** ← You are here (High-level overview)
- **[SEARCH.md](./docs/SEARCH.md)** - Search and indexing architecture
- **[RELEASE.md](./docs/RELEASE.md)** - Cross-platform release checklist

Exact dependency versions live in `package.json` and `src-tauri/Cargo.toml`.

---

## 🎯 What We're Building

A clipboard manager that **understands**, **enhances**, and **organizes** everything you copy:

| Feature | What It Does | Why It Matters |
|---------|-------------|----------------|
| **Semantic Search** | Find "Python sorting code" without remembering exact words | Find anything by meaning, not just keywords |
| **Semantic Reindex** | Backfill embeddings for older clips after enabling a model | Makes existing history immediately useful |
| **Content Detection** | Recognize URLs, code, JSON, JWTs, paths, CSV, colors, and more | Unlocks smarter previews and actions |
| **OCR Extractor** | Screenshot table → Paste as Excel data | No more manual data entry |
| **Planned Organization** | Tags and collections for high-volume clip libraries | Keeps large histories manageable |

---

## 🛠️ Technology Stack

### Core Decisions

| Layer | Technology | Why This vs Alternatives |
|-------|-----------|-------------------------|
| **Desktop** | Tauri 2.x | 10MB bundle vs Electron's 200MB, Rust security |
| **Frontend** | React 19.2 | New compiler auto-optimizes, massive ecosystem |
| **Language** | TypeScript | Type safety prevents bugs, better DX |
| **Database** | SQLite | Embedded, no server, perfect for desktop |
| **Vector Search** | SQLite-backed `VectorStore` | Local/private hybrid retrieval without a hosted vector database |
| **Styling** | Tailwind 4 | Utility-first, new Oxide engine 10x faster |
| **UI Components** | Radix UI | Headless/accessible, full control |
| **State** | Zustand | 3KB vs Redux 30KB, minimal boilerplate |
| **Build** | Vite 7 | Fast HMR, simple config |
| **Testing** | Vitest + Playwright | Fast, modern, Vite-native |

### Release Scope

ClipsX v0.1.0 ships as a local-first desktop app:

- clipboard capture and history
- text and semantic search
- content-aware previews and actions
- tags and notes
- automatic OCR for image and office clips
- in-app updates for release builds

Future hosted or direct-provider AI integrations are intentionally out of scope until the backend exists end to end.

---

## 📦 What We Store

| Content Type | Storage Strategy | Searchable | Example |
|-------------|------------------|------------|---------|
| **Plain Text** | Full text in DB | ✅ FTS + Vector | "Meeting notes" |
| **HTML** | HTML + plain in DB | ✅ Plain text | Email body |
| **Rich Text** | RTF + plain in DB | ✅ Plain text | Formatted docs |
| **Code** | Code + language in DB | ✅ FTS + Vector | `const x = 5` |
| **Images <1MB** | Thumbnail in DB, full on disk | ✅ OCR text | Screenshots |
| **Images >1MB** | Thumbnail in DB, full on disk | ✅ OCR text | Photos |
| **Files** | Paths only (not content!) | ✅ File names | ~/file.pdf |
| **URLs** | URL + metadata in DB | ✅ URL + title | https://... |

**Why this approach:**
- Always extract plain text → Everything searchable
- Preserve formatting → Paste with original style
- Smart storage → Images on disk, thumbnails in DB
- File references → Don't store 5GB videos in DB!

---

## 🏗️ Architecture

```
┌──────────────────────────────────────┐
│        React UI (Frontend)           │
│  Search • History • Preview • Config │
└────────────┬─────────────────────────┘
             │ Tauri IPC
┌────────────▼─────────────────────────┐
│      Rust Backend (Local)            │
│  Clipboard Monitor → SQLite          │
│  Content Processor → Vector DB       │
└────────────┬─────────────────────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
┌─────────┐    ┌──────────────┐
│  OCR &  │    │  Embeddings  │
│Preview  │    │ + Search     │
│Workers  │    │ Pipelines    │
└─────────┘    └──────────────┘
```

### Data Flow Example

```
1. User copies text
2. Clipboard Monitor detects change (200ms polling)
3. Extract all formats (plain, HTML, RTF)
4. Save to SQLite immediately → UI updates
5. Background jobs (async):
   - Generate embedding → Vector DB
   - Extract metadata (URLs, emails)
   - OCR if image

6. Background workers update OCR text, embeddings, and preview metadata
```

---

## �️ Development Roadmap

| Status | Focus | Scope | Outcome |
|-------|-------|-------|---------|
| **Done** | Search foundation | Persistence, tests, filter alignment, reindexing, status UX | Stable search baseline |
| **Done** | OCR baseline | Automatic OCR for image and office clips | Searchable image workflows |
| **Next** | Keyboard productivity | Faster navigation and action execution | Lower-friction daily usage |
| **Later** | Ecosystem | User scripts, plugins, and deeper app integrations | Extend ClipsX without bloating core |

**Current direction:** Focus on reliable local workflows, OCR, keyboard speed, and release hardening.

---

## 🎨 Code Organization

```
clipsx/
├── src/                          # React frontend
│   ├── features/                 # Feature-based modules
│   │   ├── clipboard/            # History, monitoring
│   │   ├── search/               # Text + semantic search
│   │   ├── transforms/           # Legacy placeholder, not on the active roadmap
│   │   └── settings/             # Config, API keys
│   ├── shared/                   # Reusable components
│   └── stores/                   # Zustand state
│
├── src-tauri/                    # Rust backend (local)
│   ├── commands/                 # Tauri IPC handlers
│   ├── services/                 # Business logic
│   │   ├── clipboard.rs          # Monitor & read
│   │   └── ocr.rs                # Image processing
│   ├── repositories/             # Data access
│   └── models/                   # Types & schemas
│
└── tests/                        # Test suites
    ├── unit/                     # 60% coverage target
    ├── integration/              # 30% coverage target
    └── e2e/                      # Critical paths only
```

**Coding Approach:** Functional-first (pure functions, immutability, composition)

---

## ⚡ Performance & Quality Targets

| Metric | Target | Why It Matters |
|--------|--------|---------------|
| Cold start | <500ms | First impression |
| Clipboard detect | <50ms | Feel instant |
| Search 10k items | <100ms | Stay productive |
| OCR extraction | <2s for common screenshots | Keep image workflows practical |
| Memory usage | <150MB | Don't slow down Mac |
| Bundle size | <15MB | Fast download/updates |
| Test coverage | >80% | Ship with confidence |

---

## 🔒 Privacy & Security

| Principle | Implementation |
|-----------|---------------|
| **Local-first** | Clipboard history, search index, tags, notes, and OCR results stay on device |
| **Transparent** | Release docs describe what is shipped today instead of future backend plans |
| **Sandboxed** | Tauri security prevents system access |
| **Predictable** | OCR, updater, and search state are surfaced directly in the UI |

**What we NEVER do:**
- ❌ Send clipboard content to our servers
- ❌ Track what you copy
- ❌ Sell your data
- ❌ Ship stubbed backend features as if they are production-ready

---

## 🚀 Getting Started

### Desktop App
```bash
npm install
npm run tauri dev
```

See [RELEASE.md](./docs/RELEASE.md) for the cross-platform release checklist.

## 📊 Current Status (July 20, 2026)

### ✅ What's Working
- **Clipboard Monitoring** - Multi-format capture (text, HTML, RTF, images, files)
- **Smart Duplicate Detection** - Content hashing prevents duplicates across sessions
- **Platform-Specific Optimization**
  - macOS: NSPasteboard.changeCount (efficient, no unnecessary reads)
  - Windows/Linux: Content hash comparison (polling fallback)
- **SQLite Storage** - FTS5 full-text search, pagination, pin/favorite
- **Semantic Search Foundation** - Persistent enablement, startup recovery, richer readiness states
- **Semantic Reindexing** - Existing history can be indexed after a model is enabled
- **Search Correctness** - Canonical filter alignment across UI and backend
- **Native OCR** - Automatic OCR queueing and searchable OCR text for image/office clips (Apple Vision, Windows OCR, or Linux Tesseract when installed)
- **Updater Wiring** - In-app update check, install flow, and restart prompt for release builds
- **React UI** - List/grid views, infinite scroll, theme toggle, sidebar navigation
- **Global Shortcut** - System-wide hotkey to toggle app (customizable)
- **Real-time Updates** - Frontend syncs automatically on clipboard changes

### 🎯 Next Up
- Improve keyboard-first navigation and quick actions
- Harden release smoke tests across macOS, Windows, and Linux
- Explore scripting/plugin hooks after the core workflow is stable
