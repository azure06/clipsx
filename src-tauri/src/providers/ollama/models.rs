use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaEndpointStatus {
    pub reachable: bool,
    pub endpoint: String,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelDescriptor {
    pub name: String,
    pub digest: Option<String>,
    pub size: Option<u64>,
}
