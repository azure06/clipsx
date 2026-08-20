//! Plain-text extraction shared by search chunking and history previews.
//! Never returns raw markup: callers get visible text only.

use scraper::{ElementRef, Html};

pub(crate) fn html_visible_text(html: &str) -> String {
    visible_node_text(Html::parse_fragment(html).root_element())
}

pub(crate) fn visible_node_text(element: ElementRef<'_>) -> String {
    let mut parts = Vec::new();
    for node in element.descendants() {
        let Some(text) = node.value().as_text() else {
            continue;
        };
        let hidden = node.ancestors().any(|ancestor| {
            ElementRef::wrap(ancestor).is_some_and(|element| {
                matches!(
                    element.value().name(),
                    "script" | "style" | "template" | "noscript" | "svg"
                )
            })
        });
        if !hidden {
            parts.push(text.as_ref());
        }
    }
    collapse_whitespace(&parts.join(" "))
}

/// `None` when the RTF contains unsafe control words or fails to parse.
pub(crate) fn rtf_visible_text(rtf: &str) -> Option<String> {
    let lower = rtf.to_ascii_lowercase();
    if ["\\bin", "\\object", "\\objdata", "\\field", "\\pict"]
        .iter()
        .any(|control| lower.contains(control))
    {
        return None;
    }
    let parsed = std::panic::catch_unwind(|| rtf_parser::RtfDocument::try_from(rtf));
    let Ok(Ok(document)) = parsed else {
        return None;
    };
    Some(collapse_whitespace(&document.get_text()))
}

pub(crate) fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_visible_text_strips_markup_and_hidden_elements() {
        let text = html_visible_text(
            "<h1>Guide</h1><p>First paragraph.</p><script>secret()</script><p>Second.</p>",
        );
        assert_eq!(text, "Guide First paragraph. Second.");
    }

    #[test]
    fn html_visible_text_walks_arbitrary_div_span_layouts() {
        let text = html_visible_text(
            "<div class=\"content\"><span>Some real paragraph text here.</span></div>",
        );
        assert_eq!(text, "Some real paragraph text here.");
    }

    #[test]
    fn rtf_visible_text_extracts_paragraphs_and_rejects_unsafe_controls() {
        let text = rtf_visible_text(r#"{\rtf1\ansi First paragraph.\par Second paragraph.}"#)
            .expect("safe rtf should parse");
        assert!(text.contains("First paragraph"));
        assert!(rtf_visible_text(r#"{\rtf1\object\objdata unsafe}"#).is_none());
    }
}
