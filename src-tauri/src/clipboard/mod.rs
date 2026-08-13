//! Coherent clipboard capture and reconstruction boundary.

pub(crate) mod capabilities;
pub mod contract;
#[cfg(test)]
mod fidelity;
mod host;
pub mod platform;

pub use host::*;
