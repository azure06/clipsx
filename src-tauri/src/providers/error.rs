use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    Cancelled,
    Disabled,
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
        match self {
            Self::Cancelled => formatter.write_str("generation was cancelled"),
            Self::Disabled => formatter.write_str("provider is disabled"),
            Self::InvalidConfiguration(message) => {
                write!(formatter, "invalid provider configuration: {message}")
            }
            Self::Unavailable(message) => write!(formatter, "provider is unavailable: {message}"),
            Self::Rejected {
                operation,
                status,
                detail,
                context_overflow,
            } => {
                write!(formatter, "provider rejected {operation} (HTTP {status})")?;
                if let Some(detail) = detail {
                    write!(formatter, ": {detail}")?;
                }
                if *context_overflow {
                    formatter.write_str(
                        ". The model context was exceeded even after bounded chunking; update Ollama or choose a model with a larger embedding context",
                    )?;
                }
                Ok(())
            }
            Self::InvalidDescriptor(message) => {
                write!(formatter, "invalid provider descriptor: {message}")
            }
            Self::InvalidOutput(message) => write!(formatter, "invalid provider output: {message}"),
        }
    }
}

impl std::error::Error for ProviderError {}

pub type ProviderResult<T> = Result<T, ProviderError>;
