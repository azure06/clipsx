//! Host-owned Ollama transport and text-embedding adapter.

pub mod client;
pub mod generation;
pub mod models;
pub mod text_embedding;

pub use generation::OllamaGenerationProvider;
pub use models::{OllamaEndpointStatus, OllamaModelDescriptor};
pub use text_embedding::{list_models, probe_endpoint, probe_model, OllamaTextEmbeddingProvider};
