//! Host-owned model-provider contracts and implementations.
#![allow(dead_code)] // Compile-safe M4b/M6 capability skeletons.

pub mod contracts;
pub mod disabled;
pub mod error;
pub mod ollama;
pub mod registry;

pub use registry::provider_capabilities;
