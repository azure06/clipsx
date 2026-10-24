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
        [m.context_limit, m.runtime_context_limit]
            .into_iter()
            .flatten()
            .min()
    });
    let separate_input = information.and_then(|m| m.input_limit);
    let known_output = information.and_then(|m| m.output_limit);
    let capacity = shared.or(separate_input);
    let context = if auto {
        capacity.unwrap_or(preset.context_limit)
    } else {
        preset.context_limit.min(capacity.unwrap_or(u32::MAX))
    };
    let output = if auto {
        (context / 4)
            .min(8192)
            .min(known_output.unwrap_or(u32::MAX))
            .min(if capacity.is_none() {
                preset.output_limit
            } else {
                u32::MAX
            })
    } else {
        preset.output_limit
    };
    let shared_window = shared.is_some() || separate_input.is_none();
    if output == 0
        || (shared_window && output >= context)
        || known_output.is_some_and(|limit| output > limit)
    {
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
    let input = if shared_window {
        (context - output).min(separate_input.unwrap_or(u32::MAX))
    } else {
        context
    };
    Ok(ResolvedExecutionPolicy {
        input_limit: input,
        output_limit: output,
        context_limit: context,
        // Advertised capacity remains usable even when the runtime allocation is unverified.
        estimated: capacity.is_none()
            || information.is_some_and(|m| m.source == "runtime_context_unknown"),
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
        assert_eq!(
            (fallback.context_limit, fallback.output_limit),
            (32768, 4096)
        );
        assert!(fallback.estimated);
        p.context_limit = 131072;
        p.output_limit = 8192;
        let edited = resolve(&p, None, None).unwrap();
        assert_eq!((edited.input_limit, edited.output_limit), (122880, 8192));
        let mut unknown_server = info();
        unknown_server.source = "runtime_context_unknown".into();
        unknown_server.runtime_context_limit = None;
        unknown_server.output_limit = None;
        let small = resolve(&p, Some(&unknown_server), None).unwrap();
        assert_eq!((small.input_limit, small.output_limit), (12288, 4096));
        p.context_limit = 32768;
        p.output_limit = 4096;
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
    fn auto_uses_model_capacity_without_a_runtime_and_has_no_application_cap() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Auto);
        let mut i = info();
        i.source = "runtime_context_unknown".into();
        i.context_limit = Some(40960);
        i.runtime_context_limit = None;
        let cold = resolve(&p, Some(&i), None).unwrap();
        assert_eq!(
            (cold.context_limit, cold.input_limit, cold.output_limit),
            (40960, 32768, 8192)
        );
        assert!(cold.estimated);
        i.context_limit = Some(200000);
        i.source = "provider_catalog".into();
        let large = resolve(&p, Some(&i), None).unwrap();
        assert_eq!((large.context_limit, large.input_limit), (200000, 191808));
        assert!(!large.estimated);
    }
    #[test]
    fn smallest_shared_limit_and_independent_input_limit_are_respected() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Auto);
        let mut i = info();
        // Runtime metadata must not override a smaller model maximum.
        i.runtime_context_limit = Some(32768);
        assert_eq!(resolve(&p, Some(&i), None).unwrap().context_limit, 16384);
        i.context_limit = Some(100000);
        i.runtime_context_limit = Some(90000);
        i.input_limit = Some(80000);
        let mixed = resolve(&p, Some(&i), None).unwrap();
        assert_eq!((mixed.context_limit, mixed.input_limit), (90000, 80000));
        i.runtime_context_limit = Some(4096);
        let small = resolve(&p, Some(&i), None).unwrap();
        assert_eq!(
            (small.context_limit, small.input_limit, small.output_limit),
            (4096, 3072, 1024)
        );
    }
    #[test]
    fn unknown_capacity_uses_saved_fallbacks_and_bounds_auto_output() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Auto);
        p.context_limit = 131072;
        p.output_limit = 8192;
        let unknown = resolve(&p, None, None).unwrap();
        assert_eq!(
            (
                unknown.context_limit,
                unknown.input_limit,
                unknown.output_limit
            ),
            (131072, 122880, 8192)
        );
        assert!(unknown.estimated);
        p.context_limit = 4096;
        p.output_limit = 8192;
        assert_eq!(resolve(&p, None, None).unwrap().output_limit, 1024);
    }
    #[test]
    fn explicit_limits_preserve_values_but_respect_both_capacity_constraints() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Explicit);
        let mut i = info();
        i.runtime_context_limit = Some(32768);
        assert_eq!(resolve(&p, Some(&i), None).unwrap().context_limit, 16384);
        p.context_limit = 8192;
        assert_eq!(resolve(&p, Some(&i), None).unwrap().context_limit, 8192);
        // Providers with independent windows may allow more output than input.
        i.context_limit = None;
        i.runtime_context_limit = None;
        i.input_limit = Some(2048);
        let separate = resolve(&p, Some(&i), None).unwrap();
        assert_eq!((separate.input_limit, separate.output_limit), (2048, 4096));
    }
    #[test]
    fn selected_budget_uses_the_effective_output_allowance() {
        let mut p = preset();
        p.options.limit_policy = Some(AiLimitPolicy::Auto);
        p.output_limit = 2048;
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
