# Clips Next - AI-Powered Clipboard Manager

> **Blazingly fast, privacy-first clipboard manager with AI superpowers**

Built with Tauri 2.x + React 19 + Rust + TypeScript

---

## 📖 Documentation

- **[README.md](./README.md)** ← You are here (High-level overview)
- **[PLANNING.md](./docs/PLANNING.md)** - Detailed implementation, code examples, schemas
- **[CODING_STYLE.md](./docs/CODING_STYLE.md)** - Functional-first style guide for TypeScript & Rust
- **[DEPENDENCIES.md](./docs/DEPENDENCIES.md)** - Why each dependency is needed
- **[PROJECT_STATUS.md](./docs/PROJECT_STATUS.md)** - Setup status and next steps

---

## 🎯 What We're Building

A clipboard manager that **understands**, **enhances**, and **organizes** everything you copy:

| Feature | What It Does | Why It Matters |
|---------|-------------|----------------|
| **Semantic Search** | Find "Python sorting code" without remembering exact words | Find anything by meaning, not just keywords |
| **Instant Transform** | Press Cmd+G → Fix grammar, change tone, summarize | Transform text in any app without switching |
| **Smart Paste** | Auto-detects context (Slack/Email/Excel) → Suggests format | Paste perfectly formatted for destination |
| **OCR Extractor** | Screenshot table → Paste as Excel data | No more manual data entry |
| **Predictive Format** | Suggests emojis, mentions, tone based on context | Saves time with smart suggestions |

---

## 🛠️ Technology Stack

### Core Decisions

| Layer | Technology | Why This vs Alternatives |
|-------|-----------|-------------------------|
| **Desktop** | Tauri 2.x | 10MB bundle vs Electron's 200MB, Rust security |
| **Frontend** | React 19.2 | New compiler auto-optimizes, massive ecosystem |
| **Language** | TypeScript | Type safety prevents bugs, better DX |
| **Database** | SQLite | Embedded, no server, perfect for desktop |
| **Vector Search** | Vectra | Local/private vs cloud (Pinecone) |
| **Styling** | Tailwind 4 | Utility-first, new Oxide engine 10x faster |
| **UI Components** | Radix UI | Headless/accessible, full control |
| **State** | Zustand | 3KB vs Redux 30KB, minimal boilerplate |
| **Build** | Vite 5 | Fast HMR, simple config |
| **Testing** | Vitest + Playwright | Fast, modern, Vite-native |

### AI Strategy (Hybrid Approach)

| Mode | Backend | Provider | User Setup |
|------|---------|----------|------------|
| **Easy Mode** (Default) | Our Cloudflare Workers | OpenRouter | None - just works |
| **Privacy Mode** (Advanced) | Direct from app | OpenAI or Claude | User provides own API key |

**Easy Mode:** Free tier with limits, Premium unlimited (via OpenRouter backend)  
**Privacy Mode:** Always unlimited (user provides own API key, pays provider directly)

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
│ Privacy │    │  Easy Mode   │
│  Mode   │    │              │
│ Direct→ │    │ Cloudflare   │
│ OpenAI/ │    │  Workers     │
│ Claude  │    │      ↓       │
└─────────┘    │ OpenRouter   │
               │      ↓       │
               │  AI Models   │
               └──────────────┘
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

When user requests AI feature:
6a. Easy Mode → Our Cloudflare Workers → OpenRouter
6b. Privacy Mode → Direct to OpenAI/Claude (user's key)
```

---

## �️ Development Roadmap

| Phase | Timeline | Features | Outcome |
|-------|----------|----------|---------|
| **1-3** | Weeks 1-4 | Basic monitor, SQLite, rich content, search | Beta 1 |
| **4-5** | Weeks 5-7 | Semantic search, AI transformers | **V1.0 Launch** 🚀 |
| **6-8** | Weeks 8-12 | Advanced paste, OCR, predictive | **V2.0** |

**V1.0 Strategy:** Ship core + AI features fast (7 weeks), validate with users, iterate

---

## 🎨 Code Organization

```
clipsx/
├── src/                          # React frontend
│   ├── features/                 # Feature-based modules
│   │   ├── clipboard/            # History, monitoring
│   │   ├── search/               # Text + semantic search
│   │   ├── transforms/           # AI transformations
│   │   └── settings/             # Config, API keys
│   ├── shared/                   # Reusable components
│   └── stores/                   # Zustand state
│
├── src-tauri/                    # Rust backend (local)
│   ├── commands/                 # Tauri IPC handlers
│   ├── services/                 # Business logic
│   │   ├── clipboard.rs          # Monitor & read
│   │   ├── ai.rs                 # AI integrations (Privacy Mode)
│   │   └── ocr.rs                # Image processing
│   ├── repositories/             # Data access
│   └── models/                   # Types & schemas
│
├── cloudflare-workers/           # Backend API (Easy Mode)
│   └── src/
│       ├── ai.ts                 # AI proxy via OpenRouter
│       ├── auth.ts               # User auth & rate limits
│       └── sync.ts               # Cloud sync (Premium tier)
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
| AI transform | <2s | Don't interrupt flow |
| Memory usage | <150MB | Don't slow down Mac |
| Bundle size | <15MB | Fast download/updates |
| Test coverage | >80% | Ship with confidence |

---

## 🔒 Privacy & Security

| Principle | Implementation |
|-----------|---------------|
| **Local-first** | All data on device, cloud sync optional |
| **User-owned AI** | You provide API keys, we never see them |
| **Encrypted** | AES-256 for sensitive data |
| **Sandboxed** | Tauri security prevents system access |
| **Transparent** | Clear what goes where |

**What we NEVER do:**
- ❌ Send clipboard content to our servers
- ❌ Track what you copy
- ❌ Sell your data
- ❌ Proxy your AI requests

---

## 🎁 Free vs Premium Features

### What Should Always Be Free?
| Feature | Why Free | Impact |
|---------|----------|--------|
| **Local clipboard history** | Core utility, no server costs | Everyone benefits |
| **Full-text search (FTS5)** | Local SQLite, zero cost | Fast search for all |
| **Privacy Mode** | User pays providers directly | Appeals to privacy-focused users |
| **All content types** | Storage is local | Rich experience for everyone |
| **Basic organization** | Pins, favorites, tags | Core UX |

### What Should Be Premium?
| Feature | Why Premium | Value Justification |
|---------|-------------|--------------------|
| **Unlimited AI (Easy Mode)** | Backend server costs | Convenience premium (no API key setup) |
| **Cloud sync** | Server storage + bandwidth costs | Multi-device professionals |
| **Semantic search** | Embedding generation costs | Power users with large histories |
| **Smart collections** | Advanced organization | Productivity boost |
| **Team features** | Complex infrastructure | Business use case |
| **Advanced AI** | OCR, context detection, workflows | Professional workflows |

### Free Tier Limits (To Consider)
| What to Limit | Option A | Option B | Option C |
|---------------|----------|----------|----------|
| **AI requests** | 50/month | 100/month | 200/month |
| **Semantic search** | Disabled | 10 queries/day | Enabled but slower |
| **Cloud sync** | Not available | 7 days history | Read-only |
| **History size** | Unlimited | Last 1000 items | Last 30 days |

**Philosophy:** Free tier should be genuinely useful (not a trial), Premium adds convenience + scale

---

## ❓ Critical Decisions Needed

| Decision | Options | ✅ Final Choice |
|----------|---------|----------------|
| **Platform** | macOS first vs all platforms | macOS → then Windows/Linux |
| **V1.0 Scope** | Week 7 vs Week 12 | Week 7 (core + AI features) |
| **AI Backend** | Direct vs OpenRouter vs Hybrid | **Hybrid** (OpenRouter + Direct) |
| **Cloud Sync** | V1.0 vs V2.0 | V2.0 (local-first approach) |
| **Monetization** | Freemium vs One-time vs Open Source | **Freemium** (decide pricing later) |
| **Hosting** | Vercel vs Cloudflare vs Self-hosted | **Cloudflare Workers** (free tier) |
| **Free Tier Limits** | Options A/B/C above | **TBD** (test with users first) |

---

## 🚀 Getting Started

### Desktop App
```bash
npm create tauri-app@latest clipsx --template react-ts
cd clipsx
npm install zustand @tanstack/react-query tailwindcss@next
cd src-tauri && cargo add tokio sqlx arboard
npm run tauri dev
```

### Backend API (Optional - for Easy Mode)
```bash
npm create cloudflare@latest cloudflare-workers
cd cloudflare-workers
npm install
npm run dev  # Local development
npm run deploy  # Deploy to Cloudflare (free tier)
```

See [PLANNING.md](./PLANNING.md) for detailed implementation guide.

---

**Ready to build? Let's make clipboard management magical! ✨**

*Status: 🚧 Active Development • ✅ Core Features Working*

---

## 📊 Current Status (February 14, 2026)

### ✅ What's Working
- **Clipboard Monitoring** - Multi-format capture (text, HTML, RTF, images, files)
- **Smart Duplicate Detection** - Content hashing prevents duplicates across sessions
- **Platform-Specific Optimization**:
  - macOS: NSPasteboard.changeCount (efficient, no unnecessary reads)
  - Windows/Linux: Content hash comparison (polling fallback)
- **SQLite Storage** - FTS5 full-text search, pagination, pin/favorite
- **React UI** - List/grid views, infinite scroll, theme toggle, sidebar navigation
- **Global Shortcut** - System-wide hotkey to toggle app (customizable)
- **Real-time Updates** - Frontend syncs automatically on clipboard changes

### 🚧 In Progress
- **Settings System** - Need persistent storage for user preferences (global shortcut, theme, etc.)
- **Clipboard Pipeline Refinement** - Abstract OS-specific logic for cleaner architecture

### 🎯 Next Up
- Customizable global shortcut UI
- Settings persistence (SQLite or JSON config file)
- Content type detection (URLs, JSON, code, colors)
- Keyboard navigation (arrow keys, number shortcuts)
- AI features (semantic search, transformations)
