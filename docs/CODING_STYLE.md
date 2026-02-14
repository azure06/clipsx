# Coding Style Guide - Clips Next

> **Philosophy:** Functional-first, immutable, composable, type-safe

This guide applies to both **TypeScript** (frontend/backend) and **Rust** (Tauri).

---

## 🎯 Core Principles

### 1. Pure Functions First
Functions should be predictable and testable.

**✅ DO:**
```typescript
// Pure - same input = same output, no side effects
const formatClipText = (text: string, maxLength: number): string => 
  text.length > maxLength ? text.slice(0, maxLength) + '...' : text

// Pure - always returns new object
const addTimestamp = <T extends object>(data: T): T & { timestamp: number } => ({
  ...data,
  timestamp: Date.now()
})
```

**❌ DON'T:**
```typescript
// Impure - modifies external state
let clipboardHistory = []
const saveClip = (item) => {
  clipboardHistory.push(item)  // Mutation!
}

// Impure - depends on external state
const getLatestClip = () => clipboardHistory[0]
```

**Rust equivalent:**
```rust
// ✅ Pure function
fn format_clip_text(text: &str, max_length: usize) -> String {
    if text.len() > max_length {
        format!("{}...", &text[..max_length])
    } else {
        text.to_string()
    }
}

// ❌ Avoid mutation
// let mut global_history = vec![];  // Don't do this
```

---

### 2. Immutability by Default

**✅ TypeScript:**
```typescript
// Use const, never let
const items = [1, 2, 3]

// Return new arrays/objects, never mutate
const addItem = (arr: number[], item: number): number[] => [...arr, item]
const updateUser = (user: User, name: string): User => ({ ...user, name })

// Readonly types
interface ClipItem {
  readonly id: string
  readonly content: string
  readonly createdAt: number
}
```

**✅ Rust:**
```rust
// Default to immutable bindings
let items = vec![1, 2, 3];

// Only use mut when absolutely necessary
let mut counter = 0;  // Rare case

// Pass by reference when possible
fn process_clip(clip: &ClipItem) -> ProcessedClip {
    // Read-only access
}
```

---

### 3. Composition Over Inheritance

No classes with inheritance chains. Build features by composing small functions.

**✅ TypeScript:**
```typescript
// Compose small functions
const withId = <T extends object>(data: T) => ({ ...data, id: crypto.randomUUID() })
const withTimestamp = <T extends object>(data: T) => ({ ...data, timestamp: Date.now() })
const withMetadata = <T extends object>(data: T) => withTimestamp(withId(data))

// Or use pipe/compose utilities
import { pipe } from './utils'

const createClipItem = pipe(
  withId,
  withTimestamp,
  validateClipItem
)

const item = createClipItem({ content: 'Hello' })
```

**❌ DON'T:**
```typescript
// Avoid class inheritance
class BaseClipItem {
  constructor(public id: string) {}
}

class TextClipItem extends BaseClipItem {
  constructor(id: string, public content: string) {
    super(id)
  }
}
```

**✅ Rust (trait composition):**
```rust
// Use traits for shared behavior
trait Timestamped {
    fn timestamp(&self) -> i64;
}

trait Identifiable {
    fn id(&self) -> &str;
}

// Compose via multiple trait bounds
fn process<T: Timestamped + Identifiable>(item: &T) {
    // Use both traits
}
```

---

### 4. Discriminated Unions Over Conditionals

Use type systems to make invalid states unrepresentable.

**✅ TypeScript:**
```typescript
// Tagged unions for state
type ClipContent = 
  | { type: 'text'; content: string }
  | { type: 'image'; buffer: ArrayBuffer; format: string }
  | { type: 'file'; paths: string[] }
  | { type: 'html'; html: string; plainText: string }

// Compiler ensures exhaustive handling
const getPreview = (clip: ClipContent): string => {
  switch (clip.type) {
    case 'text': return clip.content.slice(0, 100)
    case 'image': return `Image (${clip.format})`
    case 'file': return clip.paths.join(', ')
    case 'html': return clip.plainText.slice(0, 100)
  }
}

// Result type instead of throwing errors
type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E }

const parseClipboard = (data: unknown): Result<ClipItem, string> => {
  if (!isValidClipData(data)) {
    return { ok: false, error: 'Invalid clipboard data' }
  }
  return { ok: true, value: transformToClipItem(data) }
}
```

**✅ Rust:**
```rust
// Enums for state
enum ClipContent {
    Text { content: String },
    Image { buffer: Vec<u8>, format: String },
    File { paths: Vec<String> },
    Html { html: String, plain_text: String },
}

// Match exhaustively (compiler enforces)
fn get_preview(clip: &ClipContent) -> String {
    match clip {
        ClipContent::Text { content } => content[..100].to_string(),
        ClipContent::Image { format, .. } => format!("Image ({})", format),
        ClipContent::File { paths } => paths.join(", "),
        ClipContent::Html { plain_text, .. } => plain_text[..100].to_string(),
    }
}

// Use Result instead of panicking
fn parse_clipboard(data: &[u8]) -> Result<ClipItem, String> {
    if !is_valid_clip_data(data) {
        return Err("Invalid clipboard data".into());
    }
    Ok(transform_to_clip_item(data)?)
}
```

---

### 5. Function Signatures Should Be Self-Documenting

**✅ DO:**
```typescript
// Clear what goes in and out
type TransformText = (
  text: string,
  operation: 'summarize' | 'translate' | 'grammar'
) => Promise<string>

// Explicit options object
interface SearchOptions {
  query: string
  limit?: number
  includeImages?: boolean
}

const searchClipboard = (options: SearchOptions): Promise<ClipItem[]> => {
  // ...
}
```

**❌ DON'T:**
```typescript
// Vague, unclear
const process = (data: any, type: string, opts?: any) => { }

// Too many positional arguments
const search = (q: string, lim: number, img: boolean, fav: boolean, tags: string[]) => { }
```

**Rust:**
```rust
// ✅ Clear function signature
async fn search_clipboard(
    query: &str,
    limit: Option<usize>,
    include_images: bool,
) -> Result<Vec<ClipItem>> {
    // ...
}

// ✅ Use structs for complex params
struct SearchOptions {
    query: String,
    limit: Option<usize>,
    include_images: bool,
}

async fn search(opts: SearchOptions) -> Result<Vec<ClipItem>> {
    // ...
}
```

---

## 📁 Code Organization

### TypeScript File Structure

```typescript
// 1. Imports (grouped)
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api'

// 2. Types (at top, not scattered)
interface ClipItem {
  id: string
  content: string
}

type ClipAction = 
  | { type: 'ADD'; item: ClipItem }
  | { type: 'DELETE'; id: string }

// 3. Constants
const MAX_HISTORY_SIZE = 1000
const POLL_INTERVAL = 200

// 4. Pure functions (before components)
const filterByQuery = (items: ClipItem[], query: string) =>
  items.filter(item => item.content.includes(query))

// 5. Components/Hooks
export const useClipboardHistory = () => {
  // ...
}

export const ClipboardList = ({ items }: Props) => {
  // ...
}
```

### Rust Module Structure

```rust
// src-tauri/src/services/clipboard.rs

// 1. Imports
use anyhow::Result;
use arboard::Clipboard;
use tokio::sync::RwLock;

// 2. Types
pub struct ClipItem {
    pub id: String,
    pub content: String,
    pub created_at: i64,
}

// 3. Constants
const POLL_INTERVAL_MS: u64 = 200;
const MAX_HISTORY_SIZE: usize = 1000;

// 4. Public API
pub async fn monitor_clipboard<F>(callback: F) -> Result<()>
where
    F: Fn(ClipItem) + Send + 'static,
{
    // ...
}

// 5. Private helpers
fn hash_content(content: &str) -> u64 {
    // ...
}
```

---

## 🔄 Async/Await Patterns

### TypeScript

```typescript
// ✅ Use async/await, not .then()
const fetchClipboardHistory = async (): Promise<ClipItem[]> => {
  const items = await invoke<ClipItem[]>('get_clipboard_history')
  return items.filter(item => !item.deleted)
}

// ✅ Parallel execution when independent
const loadDashboard = async () => {
  const [history, settings, stats] = await Promise.all([
    fetchClipboardHistory(),
    fetchSettings(),
    fetchStats(),
  ])
  return { history, settings, stats }
}

// ✅ Sequential when dependent
const transformAndSave = async (text: string) => {
  const transformed = await aiService.transform(text)
  const saved = await database.save(transformed)
  return saved
}
```

### Rust

```rust
// ✅ Use async/await
async fn fetch_clipboard_history() -> Result<Vec<ClipItem>> {
    let items = sqlx::query_as::<_, ClipItem>("SELECT * FROM clips")
        .fetch_all(&pool)
        .await?;
    Ok(items)
}

// ✅ Parallel with tokio::join!
async fn load_dashboard() -> Result<Dashboard> {
    let (history, settings, stats) = tokio::join!(
        fetch_clipboard_history(),
        fetch_settings(),
        fetch_stats(),
    );
    
    Ok(Dashboard {
        history: history?,
        settings: settings?,
        stats: stats?,
    })
}
```

---

## 🎨 Naming Conventions

### TypeScript

```typescript
// PascalCase for types, interfaces, components
type ClipItem = { }
interface SearchOptions { }
const ClipboardList = () => <div />

// camelCase for functions, variables
const searchClipboard = () => { }
const currentUser = { }

// SCREAMING_SNAKE_CASE for constants
const MAX_RETRY_COUNT = 3
const API_BASE_URL = 'https://...'

// Prefix booleans with is/has/should
const isVisible = true
const hasImages = false
const shouldRefresh = true

// Event handlers: handle* or on*
const handleClick = () => { }
const onSubmit = () => { }
```

### Rust

```rust
// PascalCase for types, structs, enums, traits
struct ClipItem { }
enum ClipContent { }
trait Searchable { }

// snake_case for functions, variables, modules
fn search_clipboard() { }
let current_user = User::new();

// SCREAMING_SNAKE_CASE for constants
const MAX_RETRY_COUNT: u32 = 3;
const API_BASE_URL: &str = "https://...";

// Boolean functions: is_* or has_*
fn is_valid(&self) -> bool { }
fn has_content(&self) -> bool { }
```

---

## 🚫 What to Avoid

### TypeScript

```typescript
// ❌ No 'any' - use 'unknown' or proper types
const bad = (data: any) => data.value  // Type safety broken

// ✅ Use 'unknown' and narrow
const good = (data: unknown) => {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as { value: unknown }).value
  }
}

// ❌ No non-null assertions unless absolutely necessary
const user = getUser()!  // Dangerous!

// ✅ Handle null explicitly
const user = getUser()
if (!user) throw new Error('User not found')

// ❌ No side effects in functions that return values
const calculate = (x: number) => {
  console.log(x)  // Side effect!
  return x * 2
}

// ✅ Separate concerns
const calculate = (x: number) => x * 2
const logAndCalculate = (x: number) => {
  console.log(x)
  return calculate(x)
}
```

### Rust

```rust
// ❌ No unwrap/expect in production code
let value = some_option.unwrap();  // Will panic!

// ✅ Propagate errors with ?
let value = some_option.ok_or_else(|| anyhow!("Missing value"))?;

// ❌ No unnecessary clones
fn bad(items: &Vec<String>) -> Vec<String> {
    items.clone()  // Expensive!
}

// ✅ Return references or use Cow
fn good(items: &[String]) -> &[String] {
    items
}

// ❌ No blocking in async functions
async fn bad() {
    thread::sleep(Duration::from_secs(1));  // Blocks executor!
}

// ✅ Use async sleep
async fn good() {
    tokio::time::sleep(Duration::from_secs(1)).await;
}
```

---

## 🧪 Testing & Testability

### Design for Testability

**Core principle:** Write code that's easy to test in isolation.

**Key strategies:**
- Pure functions (no side effects) → test with simple assertions
- Dependency injection → swap real implementations with mocks
- Trait abstractions (Rust) / interfaces (TypeScript) → enable mocking
- Separate I/O from logic → test logic without touching file system/network

### TypeScript Patterns

```typescript
// ✅ Pure function - easy to test
const formatClipText = (text: string, maxLength: number): string =>
  text.length > maxLength ? text.slice(0, maxLength) + '...' : text

describe('formatClipText', () => {
  it('truncates long text', () => {
    expect(formatClipText('hello world', 5)).toBe('hello...')
  })
})

// ✅ Dependency injection - mock at boundaries
interface ClipboardAPI {
  getHistory: () => Promise<ClipItem[]>
}

const useClipboardHistory = (api: ClipboardAPI) => {
  // Logic uses injected API
}

// In tests: inject mock
const mockAPI: ClipboardAPI = {
  getHistory: vi.fn().mockResolvedValue([{ id: '1', content: 'test' }])
}

// ✅ Separate I/O from logic
// Bad: mixed concerns
const processAndSave = async (text: string) => {
  const result = transform(text)
  await fs.writeFile('output.txt', result)  // Hard to test
  return result
}

// Good: separate concerns
const transform = (text: string): string => { /* pure logic */ }
const saveToFile = async (path: string, content: string) => { /* I/O */ }

// Test transform() without touching file system
```

### Rust Patterns

```rust
// ✅ Trait abstraction enables mocking
#[async_trait]
pub trait ClipboardMonitor: Send + Sync {
    async fn has_changed(&self) -> Result<bool>;
    async fn read_content(&self) -> Result<Option<ClipboardContent>>;
}

// Real implementation
pub struct MacOSMonitor { /* ... */ }

// Test implementation
pub struct MockMonitor {
    changes: Vec<bool>,
}

impl ClipboardMonitor for MockMonitor {
    async fn has_changed(&self) -> Result<bool> {
        Ok(self.changes.pop().unwrap_or(false))
    }
}

// ✅ Pure function - easy to test
fn compute_content_hash(content: &str) -> String {
    // No I/O, no state mutation
}

#[test]
fn test_compute_content_hash() {
    assert_eq!(compute_content_hash("test"), compute_content_hash("test"));
    assert_ne!(compute_content_hash("test"), compute_content_hash("other"));
}

// ✅ Separate I/O from logic
// Bad: mixed concerns
async fn process_and_save(text: &str) -> Result<String> {
    let result = transform(text);
    tokio::fs::write("output.txt", &result).await?;  // Hard to test
    Ok(result)
}

// Good: separate concerns
fn transform(text: &str) -> String { /* pure logic */ }
async fn save_to_file(path: &Path, content: &str) -> Result<()> { /* I/O */ }

// Test transform() without file system
```

### Testing Strategy

**Unit Tests (60%)** - Pure functions, business logic
- Fast, isolated, no dependencies
- Test edge cases, error conditions
- Example: content type detection, text formatting

**Integration Tests (30%)** - Services with mocked dependencies
- Test component interactions
- Mock external dependencies (file I/O, network, clipboard APIs)
- Example: ClipboardService with MockMonitor

**E2E Tests (10%)** - Critical user flows
- Test full stack with real dependencies
- Slower, more brittle, fewer tests
- Example: copy → save → search → paste flow

### Mock External Dependencies

```typescript
// Mock file I/O
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
```

```rust
// Use traits to enable mocking
pub trait FileSystem {
    async fn read(&self, path: &Path) -> Result<String>;
    async fn write(&self, path: &Path, content: &str) -> Result<()>;
}

// Real implementation
pub struct RealFileSystem;

// Test implementation
pub struct MockFileSystem {
    files: HashMap<PathBuf, String>,
}
```

---

## 📝 Comments & Documentation

```typescript
// ❌ Don't state the obvious
const x = 5  // Set x to 5

// ✅ Explain WHY, not WHAT
const DEBOUNCE_MS = 300  // Balance between responsiveness and API rate limits

// ✅ Document complex logic
// FTS5 requires special escaping for quotes to prevent SQL syntax errors
// See: https://www.sqlite.org/fts5.html#fts5_strings
const escapedQuery = query.replace(/"/g, '""')

// ✅ JSDoc for public APIs
/**
 * Searches clipboard history using hybrid FTS + semantic search.
 * 
 * @param query - Search string (supports FTS5 syntax)
 * @param options - Search configuration
 * @returns Ranked list of matching clipboard items
 * 
 * @example
 * const results = await searchClipboard('python code', { limit: 10 })
 */
export const searchClipboard = async (
  query: string,
  options?: SearchOptions
): Promise<ClipItem[]> => {
  // ...
}
```

```rust
/// Searches clipboard history using full-text search.
///
/// # Arguments
/// * `query` - Search string (supports FTS5 syntax)
/// * `limit` - Maximum number of results
///
/// # Errors
/// Returns error if database query fails.
///
/// # Examples
/// ```
/// let results = search_clipboard("python code", Some(10)).await?;
/// ```
pub async fn search_clipboard(
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<ClipItem>> {
    // ...
}
```

---

## ⚡ Performance Guidelines

### TypeScript

```typescript
// ✅ Memoize expensive computations
import { useMemo } from 'react'

const ExpensiveComponent = ({ items }: Props) => {
  const filteredItems = useMemo(
    () => items.filter(item => item.score > 0.8),
    [items]
  )
  
  return <List items={filteredItems} />
}

// ✅ Debounce rapid updates
import { debounce } from './utils'

const handleSearch = debounce((query: string) => {
  performSearch(query)
}, 300)

// ✅ Virtual scrolling for large lists
import { useVirtualizer } from '@tanstack/react-virtual'
```

### Rust

```rust
// ✅ Use references to avoid clones
fn process_items(items: &[ClipItem]) -> Vec<String> {
    items.iter()
        .map(|item| item.content.clone())  // Only clone what's needed
        .collect()
}

// ✅ Lazy evaluation with iterators
fn expensive_operation(items: &[ClipItem]) -> Option<ClipItem> {
    items.iter()
        .filter(|item| item.score > 0.8)
        .find(|item| item.content.starts_with("TODO"))
        // Stops at first match, doesn't process entire collection
}

// ✅ Use Cow for conditional ownership
use std::borrow::Cow;

fn maybe_transform(text: &str) -> Cow<str> {
    if text.contains("important") {
        Cow::Owned(text.to_uppercase())
    } else {
        Cow::Borrowed(text)  // No allocation
    }
}
```

---

## 🔧 Enforcement

Apply these automatically:

### `.editorconfig`
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{ts,tsx,js,jsx}]
indent_style = space
indent_size = 2

[*.rs]
indent_style = space
indent_size = 4
```

### TypeScript: `eslint.config.js`
```javascript
export default [
  {
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'functional/immutable-data': 'error',
      'functional/no-let': 'warn',
    }
  }
]
```

### Rust: `clippy.toml`
```toml
# Enforce functional style
disallowed-methods = [
    { path = "std::vec::Vec::push", reason = "prefer immutable operations" }
]
```

### Pre-commit Hook
```bash
#!/bin/sh
# .git/hooks/pre-commit
npm run lint
cargo clippy -- -D warnings
```

---

**Summary:** Write code that's easy to reason about, test, and maintain. Pure functions, immutable data, and clear types make this possible.
