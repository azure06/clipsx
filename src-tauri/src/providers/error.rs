use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    Cancelled,
    Disabled,
    NotConfigured,
    InputLimit,
    Timeout,
    ModelUnavailable,
    InvalidConfiguration(String),
    Unavailable(String),
    Rejected {
        operation: String,
        status: u16,
        detail: Option<String>,
        context_overflow: bool,
    },
    InvalidDescriptor(String),
    InvalidOutput(String),
}

impl ProviderError {
    pub fn failure(&self) -> crate::failure::OperationFailure {
        use crate::failure::FailureCode;
        match self {
            Self::Cancelled => FailureCode::ProviderCancelled,
            Self::Disabled => FailureCode::ProviderDisabled,
            Self::NotConfigured => FailureCode::ProviderNotConfigured,
            Self::InputLimit => FailureCode::InputLimit,
            Self::Timeout => FailureCode::ProviderTimeout,
            Self::ModelUnavailable => FailureCode::ModelUnavailable,
            Self::InvalidConfiguration(_) => FailureCode::ProviderConfiguration,
            Self::Unavailable(_) => FailureCode::ConnectionUnavailable,
            Self::Rejected {
                context_overflow: true,
                ..
            } => FailureCode::ContextOverflow,
            Self::Rejected { status: 429, .. } => FailureCode::ProviderRateLimited,
            Self::Rejected {
                status: 500..=599, ..
            } => FailureCode::ProviderServerError,
            Self::Rejected { .. } => FailureCode::ProviderRejected,
            Self::InvalidDescriptor(_) | Self::InvalidOutput(_) => FailureCode::InvalidResponse,
        }
        .failure()
    }
    pub fn is_context_overflow(&self) -> bool {
        matches!(
            self,
            Self::Rejected {
                context_overflow: true,
                ..
            }
        )
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::Disabled => "disabled",
            Self::NotConfigured => "provider_not_configured",
            Self::InputLimit => "input_limit",
            Self::Timeout => "provider_timeout",
            Self::ModelUnavailable => "model_unavailable",
            Self::InvalidConfiguration(_) => "invalid_configuration",
            Self::Unavailable(_) => "unavailable",
            Self::Rejected {
                context_overflow: true,
                ..
            } => "context_overflow",
            Self::Rejected { .. } => "request_rejected",
            Self::InvalidDescriptor(_) => "invalid_descriptor",
            Self::InvalidOutput(_) => "invalid_output",
        }
    }
}

impl Display for ProviderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.failure().code.message())
    }
}

impl std::error::Error for ProviderError {}

pub type ProviderResult<T> = Result<T, ProviderError>;
