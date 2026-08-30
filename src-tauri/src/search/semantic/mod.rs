//! Structure-aware semantic indexing and exact vector retrieval.
mod chunking;
mod service;

#[cfg(test)]
mod qualification;

pub use service::*;
