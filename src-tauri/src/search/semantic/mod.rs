//! Structure-aware semantic indexing and exact vector retrieval.
mod chunking;
mod service;
pub mod store;

#[cfg(test)]
mod qualification;

pub use service::*;
