use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterField {
    pub field: String,
    pub label: String,
    pub description: Option<String>,
    pub control: Option<ParameterControl>,
    pub when: Option<ParameterCondition>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterControl {
    Text,
    Textarea,
    Select,
    Checkbox,
    Number,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterCondition {
    pub field: String,
    pub equals: Value,
}

fn properties(schema: &Value) -> Result<&serde_json::Map<String, Value>> {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .context("parameter UI requires declared properties")
}

pub(crate) fn validate_ui(schema: &Value, fields: &[ParameterField]) -> Result<()> {
    if fields.is_empty() {
        return Ok(());
    }
    if fields.len() > 32 || serde_json::to_vec(fields)?.len() > 16_384 {
        bail!("parameter UI exceeds host limits");
    }
    let properties = properties(schema)?;
    let mut names = BTreeSet::new();
    for field in fields {
        if !names.insert(&field.field)
            || field.label.trim().is_empty()
            || field.label.len() > 80
            || field
                .description
                .as_ref()
                .is_some_and(|text| text.len() > 256)
            || field.label.chars().any(char::is_control)
        {
            bail!("parameter UI label or field is invalid");
        }
        let declared = properties
            .get(&field.field)
            .context("parameter UI references an undeclared field")?;
        let kind = declared.get("type").and_then(Value::as_str);
        let compatible = match field.control {
            None => true,
            Some(ParameterControl::Text | ParameterControl::Textarea) => kind == Some("string"),
            Some(ParameterControl::Checkbox) => kind == Some("boolean"),
            Some(ParameterControl::Number) => matches!(kind, Some("number" | "integer")),
            Some(ParameterControl::Select) => {
                declared.get("enum").and_then(Value::as_array).is_some()
            }
        };
        if !compatible {
            bail!("parameter UI control does not match its schema");
        }
        if let Some(condition) = &field.when {
            let controller = properties
                .get(&condition.field)
                .context("parameter UI condition references an undeclared field")?;
            if condition.field == field.field
                || !matches!(
                    controller.get("type").and_then(Value::as_str),
                    Some("string" | "number" | "integer" | "boolean")
                )
                || condition.equals.is_null()
                || condition.equals.is_object()
                || condition.equals.is_array()
                || fields
                    .iter()
                    .any(|other| other.field == condition.field && other.when.is_some())
                || schema
                    .get("required")
                    .and_then(Value::as_array)
                    .is_some_and(|required| required.contains(&Value::String(field.field.clone())))
            {
                bail!("parameter UI condition is invalid");
            }
            super::manifest::validate_state_value(controller, &condition.equals)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_setup_selector(
    contribution: &super::manifest::ManifestContribution,
) -> Result<()> {
    let Some(name) = &contribution.setup_selector_parameter else {
        return Ok(());
    };
    if contribution.kind != super::manifest::ContributionKind::Transformer {
        bail!("setup selector binding is only supported on transformers");
    }
    let definition = properties(&contribution.parameter_schema)?
        .get(name)
        .context("setup selector references an undeclared parameter")?;
    let values = definition
        .get("enum")
        .and_then(Value::as_array)
        .context("setup selector must reference a primitive enum parameter")?;
    if values.is_empty()
        || !matches!(
            definition.get("type").and_then(Value::as_str),
            Some("string" | "boolean" | "number" | "integer")
        )
        || contribution
            .parameter_ui
            .iter()
            .any(|field| field.field == *name && field.when.is_some())
    {
        bail!("setup selector must be an unconditional primitive enum parameter");
    }
    for setup in &contribution.setups {
        let value = setup
            .parameters
            .get(name)
            .context("every built-in setup must supply its selector parameter")?;
        if !values.contains(value) {
            bail!("built-in setup has an invalid selector value");
        }
    }
    if values.iter().any(|value| {
        !contribution
            .setups
            .iter()
            .any(|setup| setup.parameters.get(name) == Some(value))
    }) {
        bail!("built-in setups must cover every selector choice");
    }
    Ok(())
}

pub(crate) fn normalize(
    schema: &Value,
    fields: &[ParameterField],
    parameters: &Value,
) -> Result<Value> {
    let mut result = parameters.clone();
    super::manifest::apply_schema_defaults(schema, &mut result);
    let visible = |field: &ParameterField| {
        field
            .when
            .as_ref()
            .is_none_or(|condition| result.get(&condition.field) == Some(&condition.equals))
    };
    let hidden: Vec<_> = fields
        .iter()
        .filter(|field| !visible(field))
        .map(|field| field.field.clone())
        .collect();
    for field in fields
        .iter()
        .filter(|field| visible(field) && field.required)
    {
        if result.get(&field.field).is_none_or(|value| {
            value.is_null() || value.as_str().is_some_and(|text| text.trim().is_empty())
        }) {
            bail!("{} is required", field.label);
        }
    }
    for name in hidden {
        result
            .as_object_mut()
            .context("parameters must be an object")?
            .remove(&name);
    }
    super::manifest::validate_parameters(schema, &result)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Value, Vec<ParameterField>) {
        (
            serde_json::json!({"type":"object","properties":{"preset":{"type":"string","enum":["business","custom"]},"instruction":{"type":"string","maxLength":4096}},"required":["preset"],"additionalProperties":false}),
            vec![ParameterField {
                field: "instruction".into(),
                label: "Custom instruction".into(),
                description: None,
                control: Some(ParameterControl::Textarea),
                when: Some(ParameterCondition {
                    field: "preset".into(),
                    equals: Value::String("custom".into()),
                }),
                required: true,
            }],
        )
    }
    #[test]
    fn setup_selector_requires_a_declared_covered_primitive_enum() {
        let mut contribution: super::super::manifest::ManifestContribution = serde_json::from_value(serde_json::json!({
            "id":"rewrite", "kind":"transformer", "displayName":"Rewrite",
            "setupSelectorParameter":"preset", "parameterSchema":{"type":"object","properties":{"preset":{"type":"string","enum":["business","custom"]}}},
            "setups":[{"id":"business","displayName":"Business","parameters":{"preset":"business"}},{"id":"custom","displayName":"Custom","parameters":{"preset":"custom"}}]
        })).unwrap();
        validate_setup_selector(&contribution).unwrap();
        contribution.setup_selector_parameter = Some("missing".into());
        assert!(validate_setup_selector(&contribution).is_err());
        contribution.setup_selector_parameter = Some("preset".into());
        contribution.setups[1].parameters = serde_json::json!({});
        assert!(validate_setup_selector(&contribution).is_err());
        contribution.setups[1].parameters = serde_json::json!({"preset":"invalid"});
        assert!(validate_setup_selector(&contribution).is_err());
        contribution.setups.pop();
        assert!(validate_setup_selector(&contribution).is_err());
        contribution.setup_selector_parameter = None;
        validate_setup_selector(&contribution).unwrap();
    }

    #[test]
    fn conditions_remove_inactive_values_and_require_visible_values() {
        let (schema, fields) = fixture();
        validate_ui(&schema, &fields).unwrap();
        assert_eq!(
            normalize(
                &schema,
                &fields,
                &serde_json::json!({"preset":"business","instruction":"old"})
            )
            .unwrap(),
            serde_json::json!({"preset":"business"})
        );
        assert_eq!(
            normalize(
                &schema,
                &fields,
                &serde_json::json!({"preset":"business","instruction":42})
            )
            .unwrap(),
            serde_json::json!({"preset":"business"})
        );
        assert!(normalize(
            &schema,
            &fields,
            &serde_json::json!({"preset":"custom","instruction":"  "})
        )
        .is_err());
        assert!(normalize(
            &schema,
            &fields,
            &serde_json::json!({"preset":"custom","instruction":"Short"})
        )
        .is_ok());
    }
    #[test]
    fn invalid_controls_references_and_duplicate_fields_are_rejected() {
        let (schema, mut fields) = fixture();
        fields[0].control = Some(ParameterControl::Number);
        assert!(validate_ui(&schema, &fields).is_err());
        fields[0].control = Some(ParameterControl::Textarea);
        fields[0].when.as_mut().unwrap().field = "missing".into();
        assert!(validate_ui(&schema, &fields).is_err());
        fields[0].when = None;
        fields.push(fields[0].clone());
        assert!(validate_ui(&schema, &fields).is_err());
    }
}
