//! Provider boundaries receive immutable explicit input and return validated output.

pub mod generation;
pub mod ocr;
pub mod text_embedding;
pub mod vision_description;
pub mod visual_embedding;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub provider_id: String,
    pub provider_version: String,
    pub model_id: String,
    pub model_revision: String,
}
