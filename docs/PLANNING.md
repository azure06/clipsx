# Clips Next - System Design & Planning

*Last Updated: February 15, 2026 (afternoon)*

---

## 🎯 Vision

**AI-powered clipboard manager that acts as a gateway to your workflow**

Philosophy: Clipboard as a gateway, not a destination. Every clip can be opened, edited, transformed, and sent to the right tool.

**Core Capabilities:**
- Quick paste (instant access to clipboard history)
- Open in default editor (text → editor, image → preview, code → IDE)
- Clipboard snippets (reusable templates with placeholders)
- Copy format control (paste as plain text, HTML, markdown)
- Semantic search (find by meaning, not keywords)
- AI transformations (grammar, translate, summarize)
- Multi-language support (i18n)
- Fully customizable shortcuts

**Tech Stack:** Tauri 2 (Rust) + React 19 + SQLite + AI (OpenRouter/OpenAI)

---

## 📊 Feature Roadmap

### Priority Legend
- **P0:** Blocking core functionality (must fix now)
- **P1:** Essential for MVP (needed before launch)
- **P2:** Enhances usability (nice to have for MVP)
- **P3:** Advanced features (post-MVP)

### Current Focus
1. **UI component library migration** - Refactor remaining pages to use shared components
2. **Clipboard pipeline refactor (P0)** - Improves testability
3. **Quick paste (P1)** - Core clipboard manager function
4. **Open in default editor (P1)** - Gateway functionality
5. **Floating window mode (P1)** - Essential UX
6. **Search UI (P1)** - Access existing search backend
7. **Keyboard navigation (P1)** - Power user efficiency
8. **Custom shortcuts (P1)** - User-configurable hotkeys
9. **Copy format options (P1)** - Control output format

### Completed ✅
- Multi-format monitoring (text, HTML, RTF, images, files)
- Platform-optimized change detection (macOS fast path, Windows/Linux polling)
- Content deduplication (hash-based, cross-session)
- Image normalization (pixel-based hashing)
- SQLite storage with FTS5 full-text search
- Pagination (browse + search modes)
- Real-time UI updates (event-driven)
- Global shortcut (not customizable yet)
- Theme toggle (light/dark/auto)
- List/Grid view toggle
- Sidebar navigation
- Pin/favorite/delete actions
- **Settings persistence (P0)** - JSON config file with defaults
- **Settings UI (P0)** - Full settings page with tabs, toggle switches, selects, button groups
- **Shared UI component library** - Reusable components built with Radix UI:
  - `Button` (5 variants, 3 sizes, loading state, icon slots)
  - `Switch` (Radix UI, accessible toggle)
  - `Select` (Radix UI dropdown with keyboard navigation)
  - `Input` (label, error/helper text, icons)
  - `Card` (header/footer, clickable variant)
  - `Tabs` (Radix UI, horizontal/vertical)
- **Settings page refactored** to use shared component library

### In Progress 🟡
- Migrating remaining pages (ClipboardHistory) to shared components
- Unit tests for shared components

### Blocked 🔴
- None currently

### Planned ⚪

**P1 - Essential for MVP:**
- Floating window mode (overlay like Raycast/Alfred, must not appear in dock)
- Keyboard navigation (↑↓ navigate, Enter paste)
- Quick paste (select clip → paste into active app)
- Search UI (wire to existing FTS5 backend)
- Open in default editor (text→editor, image→preview, code→IDE)
- Custom shortcuts (user-configurable hotkeys)
- Copy format options (copy as plain text, HTML, markdown, etc.)
- i18n support (internationalization, multi-language UI)

**P2 - Nice to Have:**
- Content type detection (URL, code, JSON, color, etc.)
- Rich content preview (images, HTML, formatted text)
- Clipboard snippets (save templates for frequently used text)
- ~~Settings tabs/navigation (organize settings by category)~~ ✅ Done
- Paste format control (choose format when pasting: plain text, HTML, etc.)
- Semantic search (find similar clips by meaning, not just keywords)
- Smart ranking/sorting (frecency algorithm, customizable sort options)

**P3 - Post-MVP:**
- AI transformations (grammar, translate, summarize)
- Smart paste (context-aware formatting)

### Explicitly Deferred ❌
- **Cloud sync** - V2.0 (complexity, privacy concerns)
- **Mobile apps** - Desktop-first focus
- **Team features** - Individual users first
- **Plugin system** - Premature abstraction
- **OCR** - Complex, niche use case

---

## 🏗️ System Architecture

### Component Overview

```
Frontend (React)                    Backend (Rust/Tauri)              Storage
─────────────────                   ────────────────────              ───────
ClipboardHistory                    ClipboardService                  SQLite
Search UI                    IPC    - Platform monitors               - clips
Settings Panel              <──>    - Hash deduplication              - clips_fts
AI Transforms                       - Multi-format support            - embeddings
                                    
                                    Repositories                      - tags
                                    - ClipRepository                  - collections
                                    - SettingsRepository
```

### Clipboard Monitoring Flow

**macOS (Efficient):**
1. Check NSPasteboard.changeCount (~1μs)
2. If changed → Read content → Compute hash
3. If hash exists → Update timestamp, else insert

**Windows/Linux (Polling):**
1. Poll every 500ms → Read clipboard (~5-10ms)
2. Compute hash → Check if exists
3. If hash exists → Update timestamp, else insert

**Image Normalization:**
- Hash normalized pixel data (width + height + RGBA bytes)
- Ignores metadata changes that cause false duplicates

---

## 📋 Database Schema

### Core Tables

**clips** - Main clipboard history
- Multi-format support: text, HTML, RTF, images, files
- Content hash for deduplication
- Metadata: app_name, timestamps, access_count
- Organization: is_pinned, is_favorite

**clips_fts** - Full-text search (FTS5)
- Indexes content_text for fast keyword search
- Supports phrase queries, boolean operators

**embeddings** - Semantic search (future)
- Vector representations of clip content
- Model metadata (name, dimensions)
- Enables "find by meaning" search

**tags + clip_tags** - Quick labels
- Multi-label categorization (#work, #code)
- Many-to-many relationship

**collections + clip_collections** - Project folders
- Structured organization (like folders)
- Many-to-many relationship

### Design Rationale

- **SQLite:** Embedded, transactional, fast, FTS5 built-in
- **Images on disk:** Avoids 1GB row limit, better performance
- **Content hash:** Prevents duplicates, works cross-session

---

## 🔄 Clipboard Monitoring Details

### Two-Layer Duplicate Detection

**Layer 1: Fast Change Detection** (macOS only)
```rust
let current_count = get_change_count()?; // NSPasteboard.changeCount
if current_count == last_count {
    return Ok(()); // Skip read entirely (~1μs)
}
```

**Layer 2: Content Hash Deduplication** (all platforms)
```rust
let content_hash = compute_hash(&content);
match repository.find_by_hash(&content_hash).await? {
    Some(existing) => repository.touch(&existing.id).await?,
    None => repository.insert(&clip).await?,
}
```

### Planned Architecture Improvement

**Current:** Platform checks scattered throughout code  
**Goal:** Clean trait-based abstraction

```rust
pub trait ClipboardMonitor: Send + Sync {
    async fn has_changed(&self) -> Result<bool>;
    async fn read_content(&self) -> Result<Option<ClipboardContent>>;
}
```

Benefits: Clean separation, easy testing, extensible

---

## ⚙️ Settings System

**Storage:** JSON config file in platform-specific app data directory
- macOS: `~/Library/Application Support/com.clipsx.app/settings.json`
- Windows: `%APPDATA%/com.clipsx.app/settings.json`
- Linux: `~/.config/clipsx/settings.json`

**Why JSON?** Standard approach (VS Code), human-readable, simple implementation

### Key Settings

**MVP Settings (Phase 1):**

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| theme | Enum | "system" | UI theme (light/dark/system) |
| view_mode | Enum | "list" | Display mode (list/grid) |
| global_shortcut | String | "Cmd+Shift+V" | System-wide hotkey to open app |
| enable_images | Boolean | true | Capture images |
| enable_files | Boolean | true | Capture file paths |
| enable_rich_text | Boolean | true | Capture HTML/RTF |
| excluded_apps | Array | [] | Apps to ignore |
| retention_policy | Enum | "unlimited" | How long to keep clips |
| retention_value | Integer | 0 | Value for retention (days or count) |
| default_paste_format | Enum | "auto" | Default format (auto/plain/html/markdown) |
| auto_close_after_paste | Boolean | true | Close window after pasting |

**Retention Policy Options:**
- `unlimited` - Keep everything forever (default)
- `days` - Delete clips older than X days (retention_value = days)
- `count` - Keep only last X clips (retention_value = count)

**Future Settings (Phase 2+):**
- Additional shortcuts (paste, search, open editor, etc.)
- Language (i18n)
- Sort method
- Launch at startup
- Privacy options (exclude passwords, clear on lock)
- AI provider settings
- Advanced (poll interval, logging, analytics)

**Security:** API keys stored in OS keychain (not JSON file)

**Settings UI:** Organized with tabs/sections:
- General (shortcuts, theme, language, sorting)
- Clipboard (monitoring, formats, exclusions)
- Advanced (performance, storage limits)
- AI (provider, API keys)
- Snippets (saved templates)

---

## 📊 Smart Ranking & Sorting (P2)

**Problem:** Users need different ways to find clips depending on context:
- "What did I just copy?" → Recent first
- "What do I use most?" → Frequency
- "What's most relevant now?" → Smart ranking (frecency)

**Sorting Options:**

### 1. Recency (Default)
- Sort by `created_at` DESC
- Most recently copied appears first
- Simple, predictable, works for most users

### 2. Frequency
- Sort by `access_count` DESC
- Most frequently used clips appear first
- Good for finding commonly used snippets/templates

### 3. Last Used
- Sort by `last_used_at` DESC
- Most recently pasted/opened clips first
- Useful for "what was I working on?"

### 4. Frecency (Smart Ranking) ⭐ Recommended
- Combines frequency + recency (like Firefox/Chrome history)
- Algorithm: `score = frequency * recency_weight`
- Recent + frequently used items rank highest
- Balances "just copied" vs "often used"

**Frecency Algorithm:**
```rust
fn calculate_frecency_score(clip: &ClipItem, now: i64) -> f64 {
    let age_seconds = now - clip.last_used_at;
    let age_days = age_seconds as f64 / 86400.0;
    
    // Recency decay: exponential falloff
    let recency_score = (-age_days / 30.0).exp(); // Half-life ~30 days
    
    // Frequency score: logarithmic (diminishing returns)
    let frequency_score = (clip.access_count as f64 + 1.0).ln();
    
    // Combined score
    recency_score * frequency_score * 100.0
}
```

**Recency Weights:**
- Last hour: 4x multiplier
- Last day: 2x multiplier
- Last week: 1x multiplier
- Last month: 0.5x multiplier
- Older: exponential decay

**Example Scores:**
- Clip used 50 times, 1 hour ago: High score (frequent + recent)
- Clip used 2 times, 5 minutes ago: Medium score (recent but not frequent)
- Clip used 100 times, 6 months ago: Low score (frequent but old)

### 5. Pinned First
- Pinned clips always appear at top
- Then sort by chosen method (recency/frequency/frecency)
- User can manually prioritize important clips

### 6. Alphabetical
- Sort by content (A-Z)
- Useful for finding specific text
- Less common but some users prefer it

**UI Implementation:**

**Sort Dropdown:**
```typescript
<select value={sortBy} onChange={handleSortChange}>
  <option value="frecency">Smart (Recommended)</option>
  <option value="recency">Most Recent</option>
  <option value="frequency">Most Used</option>
  <option value="last_used">Last Used</option>
  <option value="alphabetical">A-Z</option>
</select>
```

**Settings:**
- Default sort method (user preference)
- Frecency decay rate (how fast old items lose relevance)
- Show sort indicator in UI (e.g., "Sorted by: Smart")

**Database Schema Updates:**
```sql
-- Already have these columns:
-- created_at (for recency)
-- access_count (for frequency)
-- last_used_at (for last used)

-- Add frecency score (computed, can be cached)
ALTER TABLE clips ADD COLUMN frecency_score REAL DEFAULT 0.0;
CREATE INDEX idx_clips_frecency ON clips(frecency_score DESC);

-- Update frecency score periodically (background job)
-- Or compute on-the-fly (fast enough for <10K clips)
```

**Performance:**
- Frecency computation: O(n) but fast (~1ms for 10K clips)
- Cache scores, recompute on access or periodically
- Use database index for sorting

**Recommendation:**
- **Default: Frecency** (smart, balances recent + frequent)
- **Pinned always first** (user control)
- **Easy to switch** (dropdown in UI)
- **Persist preference** (settings.json)

**Future Enhancement:**
- Context-aware ranking (boost clips related to current app)
- Time-of-day patterns (boost work clips during work hours)
- Semantic relevance (boost clips similar to recent activity)

---

## 🚀 Quick Paste (P1)

**What it is:** The core clipboard manager function - select a clip from history and paste it directly into your active application.

**User Flow:**
1. User presses global shortcut (Cmd+Shift+V)
2. Floating window appears with clipboard history
3. User navigates with ↑↓ or types to search
4. User presses Enter → clip pastes into active app
5. Window closes automatically

**Implementation:**
```rust
#[tauri::command]
pub async fn paste_clip(clip_id: i64) -> Result<(), String> {
    let clip = repository.get_by_id(clip_id).await?;
    
    // Copy to system clipboard
    set_clipboard_content(&clip)?;
    
    // Simulate Cmd+V (platform-specific)
    #[cfg(target_os = "macos")]
    simulate_paste_macos()?;
    
    #[cfg(target_os = "windows")]
    simulate_paste_windows()?;
    
    #[cfg(target_os = "linux")]
    simulate_paste_linux()?;
    
    Ok(())
}
```

**Key Features:**
- Instant paste without leaving current app
- Keyboard-first interaction (Enter to paste)
- Auto-close window after paste
- Update clip's last_used timestamp and access_count

---

## 📋 Clipboard Snippets (P2)

**What it is:** Save frequently used text as reusable templates with placeholders.

**Use Cases:**
- Email signatures
- Code boilerplate (function templates, imports)
- Common responses ("Thanks for reaching out...")
- Formatted text (addresses, phone numbers)
- Placeholders: `Hello {{name}}, your order {{order_id}} is ready`

**Features:**
- Create snippet from existing clip or from scratch
- Organize with tags/categories
- Keyboard shortcut to open snippet picker
- Placeholder support with fill-in UI
- Search snippets by name or content

**Database Schema:**
```sql
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    category TEXT,
    shortcut TEXT, -- Optional custom shortcut
    placeholders TEXT, -- JSON array of placeholder names
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    access_count INTEGER DEFAULT 0
);

CREATE INDEX idx_snippets_category ON snippets(category);
CREATE INDEX idx_snippets_name ON snippets(name);
```

**UI:**
- Dedicated "Snippets" tab in sidebar
- Create/Edit/Delete snippet actions
- Preview with placeholder highlighting
- Quick insert with placeholder fill dialog

---

## 🎨 Copy Format Options (P1)

**What it is:** Control the output format when copying/pasting clips.

**Formats:**
- **Plain Text** - Strip all formatting, just raw text
- **HTML** - Preserve rich text formatting
- **Markdown** - Convert HTML to markdown
- **Code** - Preserve syntax highlighting metadata
- **Auto** - Use original format (default)

**User Controls:**

1. **Default Paste Format** (Settings)
   - User sets preferred default: auto/plain/html/markdown
   - Applied to all paste operations unless overridden

2. **Per-Clip Format Override** (Context Menu)
   - Right-click clip → "Copy as..."
   - Options: Plain Text, HTML, Markdown
   - Keyboard shortcuts: Cmd+Shift+C (plain), Cmd+Alt+C (HTML)

3. **Format Indicator** (UI)
   - Show icon badge on clips indicating format
   - Visual feedback when format is changed

**Implementation:**
```rust
#[tauri::command]
pub async fn copy_clip_as_format(
    clip_id: i64, 
    format: ClipFormat
) -> Result<(), String> {
    let clip = repository.get_by_id(clip_id).await?;
    
    let content = match format {
        ClipFormat::PlainText => strip_formatting(&clip.content),
        ClipFormat::Html => clip.content_html.unwrap_or(clip.content),
        ClipFormat::Markdown => html_to_markdown(&clip.content_html),
        ClipFormat::Auto => clip.content,
    };
    
    set_clipboard_content(&content)?;
    Ok(())
}
```

**Benefits:**
- Paste into Slack/Discord without formatting issues
- Copy code without syntax highlighting artifacts
- Convert rich text to markdown for documentation

---

## 🌍 Internationalization (i18n) (P1)

**What it is:** Multi-language support for UI text.

**Supported Languages (Initial):**
- English (en) - Default
- Spanish (es)
- French (fr)
- German (de)
- Japanese (ja)
- Chinese Simplified (zh-CN)

**Implementation:**

**Frontend (React):**
```typescript
// Use react-i18next
import { useTranslation } from 'react-i18next';

function ClipboardHistory() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('clipboard.title')}</h1>
      <button>{t('clipboard.clear_all')}</button>
    </div>
  );
}
```

**Translation Files:**
```
src/locales/
  en/translation.json
  es/translation.json
  fr/translation.json
  ...
```

**Settings:**
- Language selector in Settings → General
- Auto-detect system language on first launch
- Persist user preference in settings.json

**Scope:**
- All UI text (buttons, labels, tooltips)
- Error messages
- Notification text
- Settings descriptions

**Not Translated:**
- Clipboard content (user data)
- Log messages (developer-facing)

---

## ⌨️ Custom Shortcuts (P1)

**What it is:** User-configurable keyboard shortcuts for all actions.

**Customizable Shortcuts:**

| Action | Default | Customizable |
|--------|---------|--------------|
| Open app | Cmd+Shift+V | ✅ |
| Paste selected clip | Enter | ✅ |
| Open in editor | Cmd+O | ✅ |
| Search | Cmd+F | ✅ |
| Delete clip | Cmd+Backspace | ✅ |
| Pin/favorite | Cmd+P | ✅ |
| Copy as plain text | Cmd+Shift+C | ✅ |
| Copy as HTML | Cmd+Alt+C | ✅ |
| Navigate up/down | ↑↓ | ✅ |
| Close window | Esc | ✅ |

**Settings UI:**
- Dedicated "Shortcuts" section in Settings → General
- Click to record new shortcut
- Conflict detection (warn if shortcut already used)
- Reset to defaults button

**Implementation:**
```rust
// Tauri global shortcut registration
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub fn register_shortcuts(app: &AppHandle, settings: &AppSettings) -> Result<()> {
    let shortcut = settings.global_shortcut.parse::<Shortcut>()?;
    
    app.global_shortcut().register(shortcut, move |app, _event| {
        // Show main window
        app.get_webview_window("main")
            .unwrap()
            .show()
            .unwrap();
    })?;
    
    Ok(())
}
```

**Validation:**
- Prevent invalid combinations (e.g., single letter without modifier)
- Platform-specific validation (Cmd on macOS, Ctrl on Windows/Linux)
- Warn about system shortcuts conflicts

---

## 🚪 Open in Default Editor (Gateway Feature)

**Goal:** Make clipboard a gateway - every clip opens in the appropriate tool

### Content Type → Editor Mapping

| Content Type | Default Action | Example Apps |
|--------------|----------------|--------------|
| Text/Code | Open in editor | VS Code, TextEdit, Notepad |
| Image | Open in viewer | Preview, Photos, Eye of GNOME |
| HTML | Open in browser | Safari, Chrome, Firefox |
| JSON/CSV | Open in editor | VS Code, Excel |
| File paths | Open file/folder | Finder, Explorer, Nautilus |
| URL | Open in browser | Default browser |

### Implementation

```rust
#[tauri::command]
pub async fn open_clip_in_editor(clip: ClipItem) -> Result<(), String> {
    match clip.content_type {
        ContentType::Text | ContentType::Code => {
            let temp_path = create_temp_file(&clip.content, "txt")?;
            open::that(temp_path).map_err(|e| e.to_string())?;
        }
        ContentType::Image => {
            if let Some(path) = clip.image_path {
                open::that(path).map_err(|e| e.to_string())?;
            }
        }
        ContentType::Html => {
            let temp_path = create_temp_file(&clip.content_html, "html")?;
            open::that(temp_path).map_err(|e| e.to_string())?;
        }
        ContentType::File => {
            if let Some(paths) = clip.file_paths {
                if let Some(first) = paths.first() {
                    open::that(first).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}
```

**UI Integration:**
- Quick action: "Open in Editor" (Cmd+O)
- Keyboard: `Enter` opens in default, `Cmd+Shift+O` shows editor picker
- User customization via settings (e.g., text→VS Code, image→Photoshop)

---

## 🎨 Content Type Detection (P2)

**Goal:** Recognize content type for smart actions and proper editor selection

**Content Types:**
- URLs, Code, JSON/XML/CSV, Markdown, Tables
- Colors (HEX/RGB/HSL), File Paths, Email/Phone
- Secrets (auto-mask, auto-expire)

**Implementation Phases:**
1. Detection + visual indicators (icon badges)
2. Context-specific quick actions menu
3. Specialized previews (JSON viewer, syntax highlighter, color swatches)

---

## 🔍 Semantic Search - "Find Similar" (P2)

**What it is:** Find clips similar in meaning to a selected clip, not just keyword matches.

**User Flow:**
1. User right-clicks on a clip
2. Selects "Find Similar" from context menu
3. System generates embedding for the clip
4. Searches for clips with similar embeddings
5. Shows results ranked by semantic similarity

**Use Cases:**
- "I copied a Python function last week, find similar code"
- "Find all clips about project deadlines" (even if wording differs)
- "Show me other email responses like this one"
- Discover related content you forgot about

**Implementation:**

**Step 1: Generate Embeddings**
```rust
#[tauri::command]
pub async fn generate_embedding(text: &str) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/embeddings")
        .json(&json!({
            "model": "text-embedding-3-small",
            "input": text
        }))
        .send()
        .await?;
    
    let embedding = response.json::<EmbeddingResponse>().await?;
    Ok(embedding.data[0].embedding)
}
```

**Step 2: Store Embeddings**
```sql
CREATE TABLE embeddings (
    clip_id INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL, -- Vector as binary
    model TEXT NOT NULL, -- "text-embedding-3-small"
    dimensions INTEGER NOT NULL, -- 1536
    created_at INTEGER NOT NULL,
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX idx_embeddings_clip_id ON embeddings(clip_id);
```

**Step 3: Find Similar Clips**
```rust
#[tauri::command]
pub async fn find_similar_clips(
    clip_id: i64,
    limit: usize
) -> Result<Vec<ClipItem>, String> {
    // Get embedding for source clip
    let source_embedding = repository.get_embedding(clip_id).await?;
    
    // Get all embeddings
    let all_embeddings = repository.get_all_embeddings().await?;
    
    // Calculate cosine similarity
    let mut similarities: Vec<(i64, f32)> = all_embeddings
        .iter()
        .filter(|e| e.clip_id != clip_id) // Exclude source
        .map(|e| {
            let similarity = cosine_similarity(&source_embedding, &e.embedding);
            (e.clip_id, similarity)
        })
        .collect();
    
    // Sort by similarity (highest first)
    similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    
    // Get top N clips
    let clip_ids: Vec<i64> = similarities
        .iter()
        .take(limit)
        .map(|(id, _)| *id)
        .collect();
    
    repository.get_clips_by_ids(&clip_ids).await
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let magnitude_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let magnitude_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    dot_product / (magnitude_a * magnitude_b)
}
```

**UI Integration:**

**Context Menu:**
- Right-click clip → "Find Similar" (Cmd+Shift+S)
- Shows loading indicator while computing
- Opens search results view with similar clips
- Shows similarity score (e.g., "85% similar")

**Search Results View:**
```typescript
interface SimilarClipsResult {
  sourceClip: ClipItem;
  similarClips: Array<{
    clip: ClipItem;
    similarity: number; // 0.0 to 1.0
  }>;
}
```

**Performance Optimization:**
- Generate embeddings in background (async)
- Cache embeddings (don't regenerate on every search)
- Only generate for text clips (skip images initially)
- Batch embedding generation for multiple clips

**Settings:**
- Enable/disable semantic search (requires API key or Easy Mode)
- Auto-generate embeddings for new clips (on/off)
- Similarity threshold (minimum score to show results)

**Cost Considerations:**
- OpenAI text-embedding-3-small: $0.00002 per 1K tokens
- Average clip ~100 tokens = $0.000002 per clip
- 10,000 clips = ~$0.02 total
- Very affordable for most users

**Hybrid Search (Future Enhancement):**
Combine keyword search (FTS5) + semantic search for best results:
1. User types query
2. FTS5 finds keyword matches (fast)
3. Semantic search finds meaning matches (slower)
4. Merge and rank results by relevance score

---

## 🤖 AI Features (P3)

### Semantic Search
- Generate embeddings (OpenAI text-embedding-3-small)
- Hybrid search: FTS5 (keywords) + vector similarity (meaning)
- Example: "Python sorting" finds "list.sort()", "sorted()", "quicksort"

### AI Transformations
- Fix grammar, summarize, translate, change tone, expand/shorten
- Easy Mode: Cloudflare Workers → OpenRouter (no API key)
- Privacy Mode: Direct OpenAI/Claude (user provides key)

### Smart Paste
- Context-aware formatting suggestions
- Example: Paste into Slack → emoji formatting, Excel → column split

---

## 📊 Performance Targets

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Clipboard detect (macOS) | ~1μs | <50ms | ✅ Excellent |
| Clipboard detect (Windows/Linux) | ~5-10ms | <50ms | ✅ Good |
| Search 10K items | <100ms | <100ms | ✅ On target |
| App launch | ~300ms | <500ms | ✅ Excellent |
| Memory usage | ~80MB | <150MB | ✅ Excellent |

---

## 🔑 Key Decisions

**Tech Stack:**
- Desktop: Tauri 2 (Rust + webview)
- Frontend: React 19 + TypeScript + Zustand
- Database: SQLite with FTS5
- UI: Tailwind CSS 4 + Radix UI (component primitives)
- Component library: `src/shared/components/ui/` (Button, Switch, Select, Input, Card, Tabs)

**AI Strategy:**
- Easy Mode: Our backend → OpenRouter (95% of users)
- Privacy Mode: Direct API with user's key (5% of users)

**Platform:**
- macOS first (primary development)
- Windows/Linux later (Tauri makes cross-platform easy)

**Settings Storage:**
- JSON config file (standard approach, simple)
- OS keychain for API keys (security)

---

## 📝 Development Guidelines

**Code Style:**
- Functional-first: pure functions, immutability, composition
- Type safety: discriminated unions, Result types
- See CODING_STYLE.md for detailed patterns

**Testing & Testability:**
- Design for testability: pure functions, dependency injection, trait abstractions
- 60% unit tests (pure functions, easy to test in isolation)
- 30% integration tests (services with mocked dependencies)
- 10% E2E tests (critical user flows)
- Mock external dependencies (file I/O, clipboard APIs, network calls)

**Security:**
- All data local by default
- API keys in OS keychain
- User controls: exclude apps, auto-delete

**Internationalization:**
- All UI text must use i18n keys (no hardcoded strings)
- Use react-i18next for frontend
- Translation files in src/locales/{lang}/translation.json
- Test with multiple languages during development

---

## 📚 Feature Glossary

**Quick Paste:** The fundamental clipboard manager action - select a clip from history and paste it directly into your active application. Press global shortcut → navigate → Enter → paste. This is different from "Open in Editor" which opens the clip in an external tool.

**Clipboard Snippets:** Reusable text templates saved for frequent use. Like TextExpander or Alfred snippets. Examples: email signatures, code boilerplate, common responses. Supports placeholders like `{{name}}` for dynamic content.

**Copy Format Options:** Control how clips are copied/pasted. Choose between plain text (no formatting), HTML (rich text), markdown, or auto (original format). Prevents formatting issues when pasting into different apps.

**i18n (Internationalization):** Multi-language support for the UI. Users can switch between English, Spanish, French, German, Japanese, Chinese, etc. All UI text is translated, but clipboard content remains unchanged.

**Custom Shortcuts:** User-configurable keyboard shortcuts for all actions. Change the global shortcut, paste key, search key, etc. Includes conflict detection and platform-specific validation.

**Settings Tabs:** Organize settings into categories (General, Clipboard, Advanced, AI, Snippets) with tab navigation or table of contents for better UX.

**Paste Format Control:** Choose the format when pasting (related to Copy Format Options). Right-click → "Paste as Plain Text" or use keyboard shortcuts to override default format.

**Smart Ranking/Sorting:** Multiple ways to sort clipboard history - by recency (most recent first), frequency (most used), last used, or "frecency" (smart algorithm combining frequency + recency like Firefox history). Frecency is recommended as default - it surfaces both recently copied items and frequently used ones. Pinned clips always appear first regardless of sort method.

---

## 🐛 Known Issues

**Minor:**
- Theme toggle in Settings doesn't sync with TitleBar
- No keyboard shortcuts for navigation yet
- No floating window mode (appears in dock)

**Future Optimizations:**
- Windows: Use GetClipboardSequenceNumber() for better performance
- Linux: Use X11/Wayland events instead of polling
- Cloud sync (planned for V2.0)

---

*This document is the single source of truth for system design. Update as architecture evolves.*
