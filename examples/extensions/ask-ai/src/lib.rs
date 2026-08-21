mod bindings {
    use super::AskAi;
    wit_bindgen::generate!({ path: "../../../src-tauri/wit", world: "extension" });
    export!(AskAi);
}

use bindings::clipsx::extension::types::{
    ActionResult, ActionState, CompactModel, Content, Facet, GuestError, GuestErrorCode,
    OutputRepresentation, RenderModel, Representation,
};

struct AskAi;

impl bindings::Guest for AskAi {
    fn detect(_: String, _: Representation) -> Result<Vec<Facet>, GuestError> {
        Err(unsupported("Ask AI has no detector"))
    }

    fn render_detail(
        _: String,
        _: Representation,
        _: Option<Facet>,
    ) -> Result<RenderModel, GuestError> {
        Err(unsupported("Ask AI has no renderer"))
    }

    fn render_compact(
        _: String,
        _: Representation,
        _: Option<Facet>,
    ) -> Result<CompactModel, GuestError> {
        Err(unsupported("Ask AI has no compact renderer"))
    }

    fn transform(
        _: String,
        _: Representation,
        _: String,
    ) -> Result<Vec<OutputRepresentation>, GuestError> {
        Err(unsupported("Ask AI has no transformer"))
    }

    fn run_action(
        contribution_id: String,
        input: Representation,
        _: Option<Facet>,
        _: String,
    ) -> Result<ActionResult, GuestError> {
        let text = text(&input).ok_or_else(|| invalid("Ask AI requires text"))?;
        let encoded = encode_query(text);
        let url = match contribution_id.as_str() {
            "ask-chatgpt" => format!("https://chatgpt.com/?q={encoded}"),
            "ask-claude" => format!("https://claude.ai/new?q={encoded}"),
            _ => return Err(unsupported("unknown Ask AI action")),
        };
        if url.len() > 2048 {
            return Err(invalid("encoded prompt exceeds the destination URL limit"));
        }
        Ok(ActionResult::OpenHttpsUrl(url))
    }

    fn action_state(
        contribution_id: String,
        input: Representation,
        _: Option<Facet>,
        _: String,
    ) -> Result<ActionState, GuestError> {
        let Some(text) = text(&input) else {
            return Ok(ActionState::Hidden);
        };
        let base = match contribution_id.as_str() {
            "ask-chatgpt" => "https://chatgpt.com/?q=",
            "ask-claude" => "https://claude.ai/new?q=",
            _ => return Ok(ActionState::Hidden),
        };
        if base.len() + encoded_len(text) > 2048 {
            Ok(ActionState::Disabled(
                "The selected text is too long for this destination URL".into(),
            ))
        } else {
            Ok(ActionState::Enabled)
        }
    }
}

fn text(input: &Representation) -> Option<&str> {
    match &input.content {
        Content::Text(value) => Some(value),
        _ => None,
    }
}

fn encoded_len(value: &str) -> usize {
    value
        .as_bytes()
        .iter()
        .map(|byte| if unreserved(*byte) { 1 } else { 3 })
        .sum()
}

fn encode_query(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(encoded_len(value));
    for byte in value.as_bytes() {
        if unreserved(*byte) {
            encoded.push(char::from(*byte));
        } else {
            encoded.push('%');
            encoded.push(char::from(HEX[(byte >> 4) as usize]));
            encoded.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
    }
    encoded
}

fn unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

fn invalid(message: &str) -> GuestError {
    GuestError {
        code: GuestErrorCode::InvalidInput,
        message: message.into(),
    }
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
    fn query_encoding_is_utf8_and_reserved_safe() {
        assert_eq!(encode_query("hello world? 東京"), "hello%20world%3F%20%E6%9D%B1%E4%BA%AC");
    }

    #[test]
    fn encoded_length_matches_output() {
        let input = "emoji 🦀 & ?";
        assert_eq!(encoded_len(input), encode_query(input).len());
    }
}
