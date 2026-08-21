mod bindings {
    use super::AskLocalAi;
    wit_bindgen::generate!({ path: "../../../src-tauri/wit", world: "extension" });
    export!(AskLocalAi);
}

use bindings::clipsx::extension::types::{
    ActionDisposition, ActionResult, ActionState, CompactModel, Content, Facet, GuestError,
    GuestErrorCode, OutputContent, OutputRepresentation, RenderModel, Representation,
};

struct AskLocalAi;

impl bindings::Guest for AskLocalAi {
    fn detect(_: String, _: Representation) -> Result<Vec<Facet>, GuestError> {
        Err(unsupported("Ask Local AI has no detector"))
    }
    fn render_detail(_: String, _: Representation, _: Option<Facet>) -> Result<RenderModel, GuestError> {
        Err(unsupported("Ask Local AI has no renderer"))
    }
    fn render_compact(_: String, _: Representation, _: Option<Facet>) -> Result<CompactModel, GuestError> {
        Err(unsupported("Ask Local AI has no compact renderer"))
    }
    fn transform(_: String, _: Representation, _: String) -> Result<Vec<OutputRepresentation>, GuestError> {
        Err(unsupported("Ask Local AI has no transformer"))
    }

    fn run_action(
        _: String,
        input: Representation,
        _: Option<Facet>,
        parameters_json: String,
    ) -> Result<ActionResult, GuestError> {
        let Content::Text(text) = input.content else {
            return Err(invalid("Ask Local AI requires text"));
        };
        let parameters: serde_json::Value = serde_json::from_str(&parameters_json)
            .map_err(|_| invalid_parameters("parameters must be JSON"))?;
        let instruction = parameters
            .get("instruction")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Answer the user's request using the clipboard text below.");
        let prompt = format!("{instruction}\n\n--- clipboard text ---\n{text}");
        let generated = bindings::clipsx::extension::broker::generate_text(&prompt)
            .map_err(|message| failed(&message))?;
        let disposition = match parameters
            .get("output")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("preview")
        {
            "preview" => ActionDisposition::Preview,
            "copy" => ActionDisposition::Copy,
            "save_as_clip" => ActionDisposition::SaveAsClip,
            _ => return Err(invalid_parameters("unsupported output disposition")),
        };
        Ok(ActionResult::Output((
            vec![OutputRepresentation {
                format_key: "mime:text/plain".into(),
                mime_type: "text/plain".into(),
                content: OutputContent::Text(generated),
            }],
            disposition,
        )))
    }

    fn action_state(
        _: String,
        input: Representation,
        _: Option<Facet>,
        _: String,
    ) -> Result<ActionState, GuestError> {
        match input.content {
            Content::Text(value) if value.trim().is_empty() => {
                Ok(ActionState::Disabled("The selected text is empty".into()))
            }
            Content::Text(value) if value.len() > 256 * 1024 => Ok(ActionState::Disabled(
                "The selected text exceeds the local generation limit".into(),
            )),
            Content::Text(_) => Ok(ActionState::Enabled),
            _ => Ok(ActionState::Hidden),
        }
    }
}

fn error(code: GuestErrorCode, message: &str) -> GuestError {
    GuestError { code, message: message.chars().take(512).collect() }
}
fn invalid(message: &str) -> GuestError { error(GuestErrorCode::InvalidInput, message) }
fn invalid_parameters(message: &str) -> GuestError { error(GuestErrorCode::InvalidParameters, message) }
fn failed(message: &str) -> GuestError { error(GuestErrorCode::Failed, message) }
fn unsupported(message: &str) -> GuestError { error(GuestErrorCode::Unsupported, message) }
