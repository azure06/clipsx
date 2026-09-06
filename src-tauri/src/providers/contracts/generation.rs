use super::ProviderDescriptor;
use crate::providers::error::ProviderResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::Notify;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GenerationRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationMessage {
    pub role: GenerationRole,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct GenerationRequest {
    pub messages: Vec<GenerationMessage>,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerationExecutionLocation {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationCapabilities {
    pub streaming: bool,
    pub execution_location: GenerationExecutionLocation,
    pub context_window_tokens: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenerationCompletionReason {
    Stop,
    Length,
    Other(String),
}

#[derive(Debug, Clone)]
pub struct GenerationResponse {
    pub text: String,
    pub completion_reason: GenerationCompletionReason,
}

#[derive(Clone, Default)]
pub struct GenerationCancellation {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl GenerationCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

#[async_trait]
pub trait GenerationProvider: Send + Sync {
    fn descriptor(&self) -> ProviderDescriptor;
    fn capabilities(&self) -> GenerationCapabilities;
    async fn generate_stream(
        &self,
        request: &GenerationRequest,
        cancellation: &GenerationCancellation,
        on_delta: &(dyn Fn(String) -> ProviderResult<()> + Send + Sync),
    ) -> ProviderResult<GenerationResponse>;
}
