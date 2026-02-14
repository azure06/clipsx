# GitHub Copilot Instructions - Clips Next

> **Project Philosophy:** Functional-first, immutable, composable, type-safe

## 🎯 Core Rules

### TypeScript & React
1. **Pure Functions First** - All functions must be pure by default. Same input = same output, no side effects.
2. **Immutability Always** - Use `const`, never `let`. Return new objects/arrays using spread `{...obj}` or `[...arr]`. Never mutate.
3. **No Classes** - Use functions and composition. No class inheritance.
4. **Discriminated Unions** - Use tagged unions for state: `type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`
5. **Explicit Types** - No `any`. Use `unknown` if type is truly unknown. Prefer specific types.
6. **Function Signatures** - Must be self-documenting with clear parameter names and return types.

## 🧬 Idiomatic Patterns

### Basic Patterns

**branded-types** - Prevent mixing similar-typed values:
```typescript
type ClipId = string & { readonly __brand: 'ClipId' }
type UserId = string & { readonly __brand: 'UserId' }

const createClipId = (id: string): ClipId => id as ClipId
const createUserId = (id: string): UserId => id as UserId

// Compiler prevents mixing
const clipId = createClipId('123')
const userId = createUserId('456')
// clipId = userId // ❌ Type error!
```

**minimize-boolean** - Replace boolean flags with discriminated unions:
```typescript
// ❌ Avoid multiple booleans
type State = { loading: boolean; error: boolean; data: boolean }

// ✅ Use discriminated union
type State = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: ClipItem[] }
```

**named-arguments** - Use object parameters for clarity:
```typescript
// ❌ Positional arguments
const search = (query: string, limit: number, includeImages: boolean, caseSensitive: boolean) => {}

// ✅ Named arguments
const search = ({ query, limit = 10, includeImages = false, caseSensitive = true }: {
  query: string
  limit?: number
  includeImages?: boolean
  caseSensitive?: boolean
}) => {}
```

**impossible-states** - Make invalid states unrepresentable:
```typescript
// ❌ Can have data AND error
type BadState = { data?: ClipItem[]; error?: string }

// ✅ Either data OR error, never both
type GoodState = 
  | { ok: true; data: ClipItem[] }
  | { ok: false; error: string }
```

**parse-dont-validate** - Parse into known valid types:
```typescript
// ❌ Just validate
const isValidEmail = (s: string): boolean => /\S+@\S+/.test(s)

// ✅ Parse into new type
type Email = string & { readonly __brand: 'Email' }
const parseEmail = (s: string): Result<Email, string> => 
  /\S+@\S+/.test(s) 
    ? { ok: true, value: s as Email }
    : { ok: false, error: 'Invalid email' }
```

**unwrap-maybe-early** - Unwrap nullables at boundaries:
```typescript
// ✅ Unwrap at component boundary
const ClipDetail = ({ clipId }: { clipId: string }) => {
  const clip = useClip(clipId)
  
  if (!clip) return <NotFound />
  
  // Children work with non-null clip
  return (
    <div>
      <ClipContent clip={clip} />
      <ClipMetadata clip={clip} />
    </div>
  )
}
```

**wrap-early** - Validate at system boundaries:
```typescript
// ✅ Parse external data immediately
const parseClipboard = (raw: unknown): Result<ClipItem, string> => {
  if (!isValidClipData(raw)) {
    return { ok: false, error: 'Invalid data' }
  }
  // Now we have ClipItem, not unknown
  return { ok: true, value: transformToClipItem(raw) }
}
```

**builder-pattern** - Construct with defaults:
```typescript
class SearchQueryBuilder {
  private config = { limit: 10, includeImages: true, caseSensitive: false }
  
  limit(n: number) { return new SearchQueryBuilder({ ...this.config, limit: n }) }
  excludeImages() { return new SearchQueryBuilder({ ...this.config, includeImages: false }) }
  caseSensitive() { return new SearchQueryBuilder({ ...this.config, caseSensitive: true }) }
  
  build() { return this.config }
}

const query = new SearchQueryBuilder().limit(20).caseSensitive().build()
```

### Advanced Patterns

**railway** - Chain operations with Result type:
```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

const map = <T, U, E>(result: Result<T, E>, fn: (t: T) => U): Result<U, E> =>
  result.ok ? { ok: true, value: fn(result.value) } : result

const chain = <T, U, E>(result: Result<T, E>, fn: (t: T) => Result<U, E>): Result<U, E> =>
  result.ok ? fn(result.value) : result

// Chain operations
const processClip = (raw: unknown) =>
  chain(parseClipboard(raw), (clip) =>
    chain(validateContent(clip), (validated) =>
      saveToDatabase(validated)
    )
  )
```

**pipeline-builder** - Collect all validation errors:
```typescript
type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const validate = <T>(
  value: T,
  ...validators: Array<(v: T) => string | null>
): ValidationResult<T> => {
  const errors = validators.map(v => v(value)).filter((e): e is string => e !== null)
  return errors.length === 0 
    ? { ok: true, value }
    : { ok: false, errors }
}

// All errors collected at once
const result = validate(
  clipData,
  (d) => d.content.length === 0 ? 'Content required' : null,
  (d) => d.content.length > 10000 ? 'Content too long' : null,
  (d) => !d.id ? 'ID required' : null
)
```

**opaque-types** - Hide implementation with symbols:
```typescript
const ClipIdBrand = Symbol('ClipId')
type ClipId = { readonly [ClipIdBrand]: true; readonly value: string }

export const createClipId = (id: string): ClipId => ({ [ClipIdBrand]: true, value: id } as ClipId)
export const unwrapClipId = (id: ClipId): string => id.value

// Cannot construct outside module
```

**combinators** - Compose values of same type:
```typescript
type Predicate<T> = (value: T) => boolean

const and = <T>(...preds: Predicate<T>[]): Predicate<T> => 
  (value) => preds.every(p => p(value))

const or = <T>(...preds: Predicate<T>[]): Predicate<T> =>
  (value) => preds.some(p => p(value))

const not = <T>(pred: Predicate<T>): Predicate<T> =>
  (value) => !pred(value)

// Compose predicates
const isValidClip = and(hasContent, hasValidTimestamp, not(isDeleted))
```

**flow-branded-types** - Enforce operation sequence:
```typescript
type Unvalidated = { __state: 'unvalidated' }
type Validated = { __state: 'validated' }
type ClipData<S> = { content: string } & S

const validate = (data: ClipData<Unvalidated>): Result<ClipData<Validated>, string> => {
  // validation logic
  return { ok: true, value: data as ClipData<Validated> }
}

const save = (data: ClipData<Validated>) => {} // Only accepts validated

// save(rawData) // ❌ Type error - must validate first
```

### Architecture Patterns

**state-management** - Break state into discrete parts:
```typescript
// Use Zustand with slices
type ClipboardSlice = { clips: ClipItem[]; addClip: (c: ClipItem) => void }
type SearchSlice = { query: string; setQuery: (q: string) => void }
type State = ClipboardSlice & SearchSlice

const useStore = create<State>((set) => ({
  clips: [],
  addClip: (clip) => set((s) => ({ clips: [...s.clips, clip] })),
  query: '',
  setQuery: (query) => set({ query })
}))
```

**child-outcome** - Children communicate via callbacks:
```typescript
type Outcome<T, E> = { ok: true; result: T } | { ok: false; error: E }

const SearchForm = ({ onSearch }: { onSearch: (outcome: Outcome<string, string>) => void }) => {
  const handleSubmit = () => {
    const query = inputRef.current?.value
    if (!query) {
      onSearch({ ok: false, error: 'Query required' })
    } else {
      onSearch({ ok: true, result: query })
    }
  }
  return <form onSubmit={handleSubmit}>...</form>
}
```

**global-actions** - Centralize app-wide concerns:
```typescript
type GlobalAction = 
  | { type: 'NOTIFY'; message: string; level: 'info' | 'error' }
  | { type: 'NAVIGATE'; path: string }

const GlobalActionsContext = createContext<(action: GlobalAction) => void>(() => {})

export const useGlobalActions = () => useContext(GlobalActionsContext)

// Use anywhere
const SomeComponent = () => {
  const dispatch = useGlobalActions()
  const handleClick = () => dispatch({ type: 'NOTIFY', message: 'Saved!', level: 'info' })
}
```

**effects** - Return effect descriptions as data:
```typescript
type Effect = 
  | { type: 'HTTP'; url: string; method: string }
  | { type: 'NOTIFY'; message: string }
  | { type: 'NAVIGATE'; path: string }

// Business logic returns effects, doesn't execute them
const processClip = (clip: ClipItem): [ClipItem, Effect[]] => {
  const updated = { ...clip, processed: true }
  return [
    updated,
    [
      { type: 'HTTP', url: '/api/clips', method: 'POST' },
      { type: 'NOTIFY', message: 'Clip processed', level: 'info' }
    ]
  ]
}

// Executor interprets effects
const executeEffects = (effects: Effect[]) => {
  effects.forEach(effect => {
    if (effect.type === 'HTTP') { /* fetch */ }
    if (effect.type === 'NOTIFY') { /* show toast */ }
  })
}
```

**update-return-pipeline** - Compose update functions:
```typescript
type Update<S> = (state: S) => [S, Effect[]]

const pipe = <S>(...updates: Update<S>[]): Update<S> =>
  (state) => updates.reduce(
    ([s, effs], update) => {
      const [newS, newEffs] = update(s)
      return [newS, [...effs, ...newEffs]]
    },
    [state, []]
  )

const updateClip = pipe(
  validateClip,
  enrichWithMetadata,
  scheduleSync
)
```

### Rust (Tauri Backend)
1. **Immutable Bindings** - Default to `let`, only use `mut` when absolutely necessary.
2. **Never Panic** - No `.unwrap()` or `.expect()` in production. Use `?` operator for error propagation.
3. **References Over Clones** - Pass `&` references unless ownership transfer is needed.
4. **Async Sleep** - Use `tokio::time::sleep`, never `std::thread::sleep` in async code.
5. **Exhaustive Matching** - Always handle all enum variants in `match`.

## 📐 Code Structure

### TypeScript File Order
```typescript
// 1. Imports (grouped: React, external, internal)
// 2. Types & interfaces (at top)
// 3. Constants (SCREAMING_SNAKE_CASE)
// 4. Pure helper functions
// 5. Hooks/Components
```

### Rust Module Order
```rust
// 1. use statements
// 2. Types (struct, enum, trait)
// 3. Constants
// 4. Public API functions
// 5. Private helpers
```

## 🎨 Naming Conventions

**TypeScript:**
- `PascalCase`: Types, interfaces, React components
- `camelCase`: Functions, variables, parameters
- `SCREAMING_SNAKE_CASE`: Constants
- Booleans: `isVisible`, `hasContent`, `shouldRefresh`
- Event handlers: `handleClick`, `onSubmit`

**Rust:**
- `PascalCase`: Structs, enums, traits
- `snake_case`: Functions, variables, modules
- `SCREAMING_SNAKE_CASE`: Constants
- Booleans: `is_valid()`, `has_content()`

## 🔄 Async Patterns

**TypeScript:**
```typescript
// ✅ Use async/await, NOT .then()
const data = await fetchData()

// ✅ Parallel independent operations
const [users, posts] = await Promise.all([fetchUsers(), fetchPosts()])
```

**Rust:**
```rust
// ✅ Use .await
let data = fetch_data().await?;

// ✅ Parallel with tokio::join!
let (users, posts) = tokio::join!(fetch_users(), fetch_posts());
```

## 🚫 Never Generate

**TypeScript:**
- `any` type
- `!` non-null assertions (unless absolutely necessary)
- `let` variables (use `const`)
- Class inheritance (`class X extends Y`)
- Array mutations (`.push()`, `.splice()`)
- Object mutations
- `.then()` chains (use `async/await`)

**Rust:**
- `.unwrap()` or `.expect()` in production code
- `std::thread::sleep` in async functions
- Unnecessary `.clone()`
- `panic!()` in library code
- Mutable globals

## 📝 Comments Style

- **Don't** state the obvious: ❌ `const x = 5 // Set x to 5`
- **Do** explain WHY: ✅ `const DEBOUNCE_MS = 300 // Balance responsiveness vs API rate limits`
- **Do** document complex logic with references
- **Do** use JSDoc for public APIs in TypeScript
- **Do** use `///` doc comments for public Rust APIs

## 🧩 Examples to Follow

**TypeScript:**
```typescript
// ✅ Pure function with clear type
const formatClipText = (text: string, maxLength: number): string => 
  text.length > maxLength ? text.slice(0, maxLength) + '...' : text

// ✅ Discriminated union for state
type ClipContent = 
  | { type: 'text'; content: string }
  | { type: 'image'; buffer: ArrayBuffer; format: string }
  | { type: 'file'; paths: string[] }

// ✅ Result type instead of throwing
type Result<T, E> = 
  | { ok: true; value: T }
  | { ok: false; error: E }

const parseData = (raw: unknown): Result<Data, string> => {
  if (!isValid(raw)) return { ok: false, error: 'Invalid data' }
  return { ok: true, value: transform(raw) }
}
```

**Rust:**
```rust
// ✅ Pure function with Result
pub async fn search_clipboard(
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<ClipItem>> {
    let items = sqlx::query_as::<_, ClipItem>("SELECT * FROM clips")
        .fetch_all(&pool)
        .await?;
    Ok(items)
}

// ✅ Enum for state
pub enum ClipContent {
    Text { content: String },
    Image { buffer: Vec<u8>, format: String },
    File { paths: Vec<String> },
}
```

## 🧪 Testing

- Test pure functions directly (no mocking needed)
- Mock only at boundaries (API, filesystem, database)
- One assertion per test preferred
- Use descriptive test names: `test_formats_long_text_with_ellipsis`

## ⚡ Performance Preferences

**React:**
- Use `useMemo` for expensive computations
- Use `useCallback` for function props to prevent re-renders
- Virtual scrolling for large lists
- Debounce user input (300ms default)

**Rust:**
- Prefer iterator chains over collecting intermediate results
- Use `&[T]` slices over `&Vec<T>`
- Use `Cow<str>` for conditional ownership
- Lazy evaluation with `.iter()` chains

---

**When suggesting code:** Always follow these principles. Generate production-ready code that matches this style guide. Prioritize readability, testability, and functional patterns.
