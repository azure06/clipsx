//! Safe host failures: reason and recovery are independent of provider/guest text.
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Recovery {
    Stop,
    Wait,
    Retry,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    InputLimit,
    ContextOverflow,
    ProviderNotConfigured,
    ProviderDisabled,
    ProviderConfiguration,
    ModelUnavailable,
    ConnectionUnavailable,
    ProviderTimeout,
    ProviderRateLimited,
    ProviderServerError,
    ProviderRejected,
    InvalidResponse,
    InvalidOutput,
    PermissionRequired,
    UnsupportedInput,
    InvalidInput,
    InvalidParameters,
    ExtensionFailed,
    ExtensionTimeout,
    ResourceLimit,
    ExtensionTrap,
    ExtensionFailedAfterOutputLimit,
    ProviderCancelled,
    StaleContext,
    UnknownFailure,
}

impl FailureCode {
    pub fn is_guest_fault(self) -> bool {
        matches!(
            self,
            Self::ExtensionFailed
                | Self::ExtensionFailedAfterOutputLimit
                | Self::ExtensionTimeout
                | Self::ResourceLimit
                | Self::ExtensionTrap
                | Self::InvalidOutput
        )
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InputLimit => "input_limit",
            Self::ContextOverflow => "context_overflow",
            Self::ProviderNotConfigured => "provider_not_configured",
            Self::ProviderDisabled => "provider_disabled",
            Self::ProviderConfiguration => "provider_configuration",
            Self::ModelUnavailable => "model_unavailable",
            Self::ConnectionUnavailable => "connection_unavailable",
            Self::ProviderTimeout => "provider_timeout",
            Self::ProviderRateLimited => "provider_rate_limited",
            Self::ProviderServerError => "provider_server_error",
            Self::ProviderRejected => "provider_rejected",
            Self::InvalidResponse => "invalid_response",
            Self::InvalidOutput => "invalid_output",
            Self::PermissionRequired => "permission_required",
            Self::UnsupportedInput => "unsupported_input",
            Self::InvalidInput => "invalid_input",
            Self::InvalidParameters => "invalid_parameters",
            Self::ExtensionFailed => "extension_failed",
            Self::ExtensionTimeout => "extension_timeout",
            Self::ResourceLimit => "resource_limit",
            Self::ExtensionTrap => "extension_trap",
            Self::ExtensionFailedAfterOutputLimit => "extension_failed_after_output_limit",
            Self::ProviderCancelled => "provider_cancelled",
            Self::StaleContext => "stale_context",
            Self::UnknownFailure => "unknown_failure",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::InputLimit => "The input exceeds the supported request size. Shorten the input and try again.",
            Self::ContextOverflow => "The model reported insufficient context. Shorten the input or choose a model with a larger context.",
            Self::ProviderNotConfigured => "Local Text Generation is not configured.",
            Self::ProviderDisabled => "Local Text Generation is disabled.",
            Self::ProviderConfiguration => "The text generation configuration is invalid. Review Local Text Generation settings.",
            Self::ModelUnavailable => "The selected model is unavailable. Check or install it in Local Text Generation settings.",
            Self::ConnectionUnavailable => "ClipsX cannot reach the model provider. Check that Ollama is running.",
            Self::ProviderTimeout => "The model provider did not finish within the allowed time.",
            Self::ProviderRateLimited => "The model provider is temporarily limiting requests.",
            Self::ProviderServerError => "The model provider reported a temporary server error.",
            Self::ProviderRejected => "The model provider rejected the request. It did not provide a recognized reason.",
            Self::InvalidResponse => "The model provider returned an invalid or incomplete response.",
            Self::InvalidOutput => "The extension returned output that ClipsX cannot use.",
            Self::PermissionRequired => "The extension's required permission is missing or was revoked. Review its permissions.",
            Self::UnsupportedInput => "This operation does not support the selected input.",
            Self::InvalidInput => "The selected input is not valid for this operation.",
            Self::InvalidParameters => "The operation's parameters are invalid. Review its configuration.",
            Self::ExtensionFailed => "The extension could not complete this operation.",
            Self::ExtensionTimeout => "The extension exceeded its execution deadline.",
            Self::ResourceLimit => "The extension exceeded a host resource limit.",
            Self::ExtensionTrap => "The extension stopped unexpectedly during execution.",
            Self::ExtensionFailedAfterOutputLimit => "The extension could not complete after the model reached its output limit. Try shorter input.",
            Self::ProviderCancelled => "Generation was cancelled.",
            Self::StaleContext => "The source or authorization changed, so this operation was cancelled.",
            Self::UnknownFailure => "The operation failed for an unknown reason.",
        }
    }

    pub fn failure(self) -> OperationFailure {
        let recovery = match self {
            Self::ProviderNotConfigured
            | Self::ProviderDisabled
            | Self::ProviderConfiguration
            | Self::ModelUnavailable => Recovery::Wait,
            Self::ConnectionUnavailable
            | Self::ProviderTimeout
            | Self::ProviderRateLimited
            | Self::ProviderServerError => Recovery::Retry,
            Self::ProviderCancelled | Self::StaleContext => Recovery::Cancel,
            _ => Recovery::Stop,
        };
        OperationFailure {
            code: self,
            recovery,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct OperationFailure {
    pub code: FailureCode,
    pub recovery: Recovery,
}

impl OperationFailure {
    pub fn from_error(error: &anyhow::Error) -> Self {
        if let Some(failure) = error.chain().find_map(|cause| cause.downcast_ref::<Self>()) {
            *failure
        } else if let Some(provider) = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<crate::providers::error::ProviderError>())
        {
            provider.failure()
        } else {
            FailureCode::UnknownFailure.failure()
        }
    }
}

impl fmt::Display for OperationFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code.message())
    }
}
impl std::error::Error for OperationFailure {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrapped_failures_preserve_reason_and_policy_without_raw_content() {
        let error =
            anyhow::Error::new(FailureCode::InputLimit.failure()).context("private content");
        let failure = OperationFailure::from_error(&error);
        assert_eq!(failure.code, FailureCode::InputLimit);
        assert_eq!(failure.recovery, Recovery::Stop);
        assert!(!serde_json::to_string(&failure).unwrap().contains("private"));
        assert_eq!(
            OperationFailure::from_error(&anyhow::anyhow!("private credential")).code,
            FailureCode::UnknownFailure
        );
    }

    #[test]
    fn provider_reason_survives_wrapping_and_does_not_count_as_a_guest_fault() {
        let error = anyhow::Error::new(crate::providers::error::ProviderError::Timeout)
            .context("generation step");
        let failure = OperationFailure::from_error(&error);
        assert_eq!(failure.code, FailureCode::ProviderTimeout);
        assert_eq!(failure.recovery, Recovery::Retry);
        assert!(!failure.code.is_guest_fault());
        assert!(FailureCode::ExtensionTimeout.is_guest_fault());
        assert_eq!(
            FailureCode::ExtensionTimeout.failure().recovery,
            Recovery::Stop
        );
    }
}
