//! Host-owned AI infrastructure shared by search, Recall, and extensions.
pub mod configuration;
pub mod contracts;
pub mod credentials;
pub mod decision;
pub mod embedding;
pub mod http;
pub mod model_information;
pub mod privacy;
#[cfg(test)]
mod privacy_tests;
