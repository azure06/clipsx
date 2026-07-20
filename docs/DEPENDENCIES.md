# Dependencies Overview

Exact versions live in `package.json` and `src-tauri/Cargo.toml`.

## Frontend

- React 19, TypeScript, Vite, Tailwind CSS, Zustand, and Radix UI.
- Tauri API plus autostart, clipboard manager, dialog, filesystem, shell, and updater plugins.
- `react-markdown`, `remark-gfm`, and Mermaid for content previews.
- Vitest and Testing Library for frontend tests; ESLint and Prettier for quality checks.

## Backend

- Tauri 2, Tokio, SQLite via sqlx, and arboard for clipboard access.
- fastembed for text embeddings; ONNX Runtime, ndarray, and tokenizers for visual search.
- Native OCR engines: Apple Vision, Windows.Media.Ocr, and the `tesseract` executable on Linux.

## Notes

- Text Search is cache-managed through fastembed; Image Search downloads checksum-verified assets managed by ClipsX.
- OCR is not an AI capability download. On Linux it is unavailable when `tesseract` is not installed.
- QR decoding is internal deferred infrastructure; it has no production UI or decoder dependency yet.
