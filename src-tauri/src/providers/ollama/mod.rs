//! Ollama implementations. Text embeddings currently live in the semantic host
//! and will migrate here behind `TextEmbeddingProvider` without changing IPC.

pub mod client;
pub mod models;
pub mod text_embedding;
