//! Host-owned Ollama transport and text-embedding adapter.

pub mod client;
pub mod generation;
pub mod models;
pub mod text_embedding;

pub use generation::OllamaGenerationProvider;
pub use models::{discover_models, inspect_model};
pub use text_embedding::OllamaTextEmbeddingProvider;
