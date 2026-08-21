mod bindings {
    use super::MermaidViewer;
    wit_bindgen::generate!({ path: "../../../src-tauri/wit", world: "extension" });
    export!(MermaidViewer);
}

use bindings::clipsx::extension::types::{
    ActionResult, ActionState, CompactModel, Content, Facet, GuestError, GuestErrorCode,
    OutputRepresentation, RenderModel, Representation,
};

struct MermaidViewer;

impl bindings::Guest for MermaidViewer {
    fn detect(contribution_id: String, input: Representation) -> Result<Vec<Facet>, GuestError> {
        if contribution_id != "detect-mermaid" {
            return Ok(Vec::new());
        }
        let Content::Text(text) = input.content else {
            return Ok(Vec::new());
        };
        let first = text.lines().find(|line| !line.trim().is_empty()).unwrap_or_default().trim();
        let detected = [
            "flowchart ",
            "graph ",
            "sequenceDiagram",
            "classDiagram",
            "stateDiagram",
            "erDiagram",
            "gantt",
        ]
        .iter()
        .any(|prefix| first.starts_with(prefix));
        Ok(detected
            .then(|| Facet {
                id: "mermaid".into(),
                payload_json: serde_json::json!({ "schemaVersion": 1 }).to_string(),
            })
            .into_iter()
            .collect())
    }

    fn render_detail(_: String, _: Representation, _: Option<Facet>) -> Result<RenderModel, GuestError> {
        Err(unsupported("Mermaid detail is provided by isolated package UI"))
    }
    fn render_compact(_: String, _: Representation, _: Option<Facet>) -> Result<CompactModel, GuestError> {
        Err(unsupported("Mermaid uses the host compact summary"))
    }
    fn transform(_: String, _: Representation, _: String) -> Result<Vec<OutputRepresentation>, GuestError> {
        Err(unsupported("Mermaid Viewer has no transformer"))
    }
    fn run_action(_: String, _: Representation, _: Option<Facet>, _: String) -> Result<ActionResult, GuestError> {
        Err(unsupported("Mermaid Viewer has no action"))
    }
    fn action_state(_: String, _: Representation, _: Option<Facet>, _: String) -> Result<ActionState, GuestError> {
        Ok(ActionState::Hidden)
    }
}

fn unsupported(message: &str) -> GuestError {
    GuestError { code: GuestErrorCode::Unsupported, message: message.into() }
}
