//! Host-owned model-provider contracts and implementations.
#![allow(dead_code)] // Compile-safe M4b/M6 capability skeletons.

pub mod contracts;
pub mod disabled;
pub mod error;
pub mod generation;
pub mod native_ocr;
pub mod ollama;
pub mod registry;

pub use registry::{
    provider_capabilities, text_embedding_provider, TextEmbeddingProviderConfig,
    OLLAMA_TEXT_EMBEDDING_ID,
};
