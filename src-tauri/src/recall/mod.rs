//! Recall's restricted native transport. Clipboard services remain Rust-owned.
pub mod contracts;
pub mod ipc;
pub mod mcp;
#[cfg(test)]
mod mcp_tests;
pub mod mutations;
#[cfg(feature = "recall-runtime-probe")]
pub mod runtime_probe;
pub mod service;
#[cfg(test)]
mod service_tests;
pub mod transport;
