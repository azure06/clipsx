//! Coherent clipboard capture and reconstruction boundary.

pub mod contract;
#[cfg(test)]
mod fidelity;
mod host;
pub mod platform;

pub use host::*;
