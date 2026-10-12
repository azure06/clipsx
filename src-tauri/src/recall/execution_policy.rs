//! Pure policy resolution; provider discovery and UI do not own execution budgets.
use super::contracts::*;
use anyhow::{bail, Result};

pub fn resolve(
    preset: &AiModelPreset,
    information: Option<&ModelInformation>,
    reasoning: Option<ReasoningSelection>,
) -> Result<ResolvedExecutionPolicy> {
    let auto = matches!(preset.options.limit_policy, Some(AiLimitPolicy::Auto));
    let shared = information.and_then(|m| {
        if m.source == "runtime_context_unknown" {
            m.runtime_context_limit
        } else {
            m.runtime_context_limit.or(m.context_limit)
        }
    });
    let separate_input = information.and_then(|m| m.input_limit);
    let known_output = information.and_then(|m| m.output_limit);
    let capacity = shared.or(separate_input);
    let context = if auto {
        capacity.unwrap_or(8192).min(32768)
    } else {
        preset.context_limit.min(capacity.unwrap_or(u32::MAX))
    };
    let output = if auto {
        (context / 4)
            .min(8192)
            .min(known_output.unwrap_or(u32::MAX))
    } else {
        preset.output_limit
    };
    if output == 0 || output >= context || known_output.is_some_and(|limit| output > limit) {
        bail!("invalid_model_limits");
    }
    let thinking = match reasoning.as_ref() {
        Some(ReasoningSelection::Budget { tokens }) => Some(*tokens),
        Some(_) => None,
        None => preset
            .options
            .anthropic
            .as_ref()
            .and_then(|o| o.thinking_budget)
            .or_else(|| {
                preset
                    .options
                    .gemini
                    .as_ref()
                    .and_then(|o| o.thinking_budget)
            }),
    };
    if thinking.is_some_and(|budget| budget > 0 && budget >= output) {
        bail!("invalid_thinking_budget");
    }
    let input = if shared.is_some() || separate_input.is_none() {
        context - output
    } else {
        context
    };
    Ok(ResolvedExecutionPolicy {
        input_limit: input,
        output_limit: output,
        context_limit: context,
        estimated: capacity.is_none(),
        source: information
            .map(|m| m.source.clone())
            .unwrap_or_else(|| "unverified_configuration".into()),
        reasoning,
        max_steps: 8,
        max_compactions: 2,
        deadline_ms: 600_000,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::configuration::{default_options, unknown_capabilities};
    fn preset() -> AiModelPreset {
        AiModelPreset {
            id: "p".into(),
            name: "p".into(),
            connection_id: "c".into(),
            model_id: "m".into(),
            purpose: AiModelPurpose::Chat,
            context_limit: 32768,
            output_limit: 4096,
            options: default_options(),
            capabilities: unknown_capabilities(),
        }
    }
    fn info() -> ModelInformation {
        ModelInformation {
            identity: "m".into(),
            context_limit: Some(16384),
            input_limit: None,
            output_limit: Some(8192),
            runtime_context_limit: Some(8192),
            tools: None,
            vision: None,
            structured_output: None,
            reasoning_output: None,
            source: "provider_catalog".into(),
            observed_at: 0.0,
        }
    }
    #[test]
    fn legacy_limits_are_preserved_and_known_runtime_limits_bound_input() {
        let p = preset();
        let value = resolve(&p, None, None).unwrap();
        assert_eq!((value.context_limit, value.output_limit), (32768, 4096));
        assert!(value.estimated);
        assert_eq!(resolve(&p, Some(&info()), None).unwrap().input_limit, 4096);
    }
    #[test]
    fn auto_unknown_shared_and_separate_windows() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Auto);
        let fallback = resolve(&p, None, None).unwrap();
        assert_eq!((fallback.input_limit, fallback.output_limit), (6144, 2048));
        let mut i = info();
        i.runtime_context_limit = None;
        i.context_limit = None;
        i.input_limit = Some(32768);
        let separate = resolve(&p, Some(&i), None).unwrap();
        assert_eq!((separate.input_limit, separate.output_limit), (32768, 8192));
        i.output_limit = Some(1024);
        assert_eq!(resolve(&p, Some(&i), None).unwrap().output_limit, 1024);
    }
    #[test]
    fn selected_budget_uses_the_effective_output_allowance() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Auto);
        assert!(resolve(&p, None, Some(ReasoningSelection::Budget { tokens: 2048 })).is_err());
        assert!(resolve(&p, None, Some(ReasoningSelection::Budget { tokens: 1024 })).is_ok());
    }
    #[test]
    fn incompatible_explicit_output_fails_without_silent_rewrite() {
        let mut i = info();
        i.output_limit = Some(1024);
        assert!(resolve(&preset(), Some(&i), None).is_err());
    }
}
