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
        let detected = diagram_declaration(&text).is_some();
        Ok(detected
            .then(|| Facet {
                id: "mermaid".into(),
                payload_json: serde_json::json!({ "schemaVersion": 1 }).to_string(),
            })
            .into_iter()
            .collect())
    }

    fn render_detail(
        _: String,
        _: Representation,
        _: Option<Facet>,
    ) -> Result<RenderModel, GuestError> {
        Err(unsupported(
            "Mermaid detail is provided by isolated package UI",
        ))
    }
    fn render_compact(
        _: String,
        _: Representation,
        _: Option<Facet>,
    ) -> Result<CompactModel, GuestError> {
        Err(unsupported("Mermaid uses the host compact summary"))
    }
    fn transform(
        _: String,
        _: Representation,
        _: String,
    ) -> Result<Vec<OutputRepresentation>, GuestError> {
        Err(unsupported("Mermaid Viewer has no transformer"))
    }
    fn run_action(
        _: String,
        _: Representation,
        _: Option<Facet>,
        _: String,
    ) -> Result<ActionResult, GuestError> {
        Err(unsupported("Mermaid Viewer has no action"))
    }
    fn action_state(
        _: String,
        _: Representation,
        _: Option<Facet>,
        _: String,
    ) -> Result<ActionState, GuestError> {
        Ok(ActionState::Hidden)
    }
}

fn diagram_declaration(source: &str) -> Option<&str> {
    let mut lines = source.trim_start_matches('\u{feff}').lines().peekable();
    let first = lines.find(|line| !line.trim().is_empty())?.trim();
    let mut candidate = first;

    if candidate == "---" {
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
        candidate = lines
            .find(|line| {
                let line = line.trim();
                !line.is_empty() && !line.starts_with("%%")
            })?
            .trim();
    } else if candidate.starts_with("%%") {
        candidate = lines
            .find(|line| {
                let line = line.trim();
                !line.is_empty() && !line.starts_with("%%")
            })?
            .trim();
    }

    const STARTERS: &[&str] = &[
        "flowchart",
        "graph",
        "sequenceDiagram",
        "classDiagram",
        "stateDiagram-v2",
        "stateDiagram",
        "erDiagram",
        "journey",
        "gantt",
        "pie",
        "quadrantChart",
        "requirementDiagram",
        "gitGraph",
        "C4Context",
        "C4Container",
        "C4Component",
        "C4Dynamic",
        "C4Deployment",
        "mindmap",
        "timeline",
        "zenuml",
        "sankey-beta",
        "xychart-beta",
        "block-beta",
        "packet-beta",
        "kanban",
        "architecture-beta",
        "radar-beta",
        "treemap-beta",
    ];
    STARTERS.iter().copied().find(|starter| {
        candidate == *starter
            || candidate
                .strip_prefix(*starter)
                .is_some_and(|rest| rest.chars().next().is_some_and(char::is_whitespace))
    })
}

fn unsupported(message: &str) -> GuestError {
    GuestError {
        code: GuestErrorCode::Unsupported,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_pie_and_declarations_after_metadata() {
        assert_eq!(
            diagram_declaration("pie title NETFLIX\n  \"Looking\" : 90"),
            Some("pie")
        );
        assert_eq!(
            diagram_declaration("%%{init: { 'theme': 'neutral' }}%%\nflowchart LR\nA-->B"),
            Some("flowchart")
        );
        assert_eq!(
            diagram_declaration("---\ntitle: Example\n---\nsequenceDiagram\nA->>B: Hello"),
            Some("sequenceDiagram")
        );
    }

    #[test]
    fn rejects_ordinary_text() {
        assert_eq!(diagram_declaration("This is ordinary prose."), None);
        assert_eq!(diagram_declaration("graphical results"), None);
    }
}
