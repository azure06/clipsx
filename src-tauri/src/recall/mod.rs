//! Recall's restricted native transport. Clipboard services remain Rust-owned.
#[cfg(feature = "recall-runtime-probe")]
pub mod acceptance_probe;
pub mod agent;
#[cfg(test)]
mod agent_tests;
pub mod configuration;
#[cfg(test)]
mod configuration_tests;
pub mod context_repository;
pub mod contracts;
#[cfg(test)]
mod conversation_tests;
pub mod conversations;
pub mod credentials;
pub mod decision;
pub mod execution_policy;
pub mod ipc;
pub mod mcp;
#[cfg(test)]
mod mcp_tests;
pub mod model_information;
pub mod mutations;
pub mod reasoning;
#[cfg(feature = "recall-runtime-probe")]
pub mod runtime_probe;
pub mod service;
#[cfg(test)]
mod service_tests;
pub mod transport;
