//! Artifact producer boundary. Producers receive explicit ready inputs and
//! return derived values; scheduling and persistence remain host-owned.

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactProducerContract {
    pub id: &'static str,
    pub version: &'static str,
    pub artifact_kind: &'static str,
}
