# Search Feature

## Responsibilities
- Full-text search (SQLite FTS5)
- Semantic search (vector embeddings)
- Search filters (type, date, source app)
- Search result ranking for the active mode

## Components
- `SearchBar.tsx` - Search input with filters
- `SearchResults.tsx` - Results list with highlighting

## Hooks
- `useSearch.ts` - Search state and execution
- `useSearchFilters.ts` - Filter management

## Types
- `SearchQuery` - Search request interface
- `SearchResult` - Result with ranking info
