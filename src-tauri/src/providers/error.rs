use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    Disabled,
    Unavailable(String),
    InvalidDescriptor(String),
    InvalidOutput(String),
}

impl Display for ProviderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => formatter.write_str("provider is disabled"),
            Self::Unavailable(message) => write!(formatter, "provider is unavailable: {message}"),
            Self::InvalidDescriptor(message) => {
                write!(formatter, "invalid provider descriptor: {message}")
            }
            Self::InvalidOutput(message) => write!(formatter, "invalid provider output: {message}"),
        }
    }
}

impl std::error::Error for ProviderError {}

pub type ProviderResult<T> = Result<T, ProviderError>;
