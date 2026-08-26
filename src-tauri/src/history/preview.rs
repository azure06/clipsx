//! Built-in resolver for `ClipSummary.history_preview`. Deterministic, bounded,
//! and always useful — never the generic "Binary or file content" fallback.

use crate::contracts::{CompactPresentation, HistoryPreview, LeadingVisual};
use crate::text::{html_visible_text, rtf_visible_text};

const SNIPPET_MAX_CHARS: usize = 200;

pub(crate) struct PreviewContext<'a> {
    pub presentation_kind: &'a str,
    pub leading_mime: Option<&'a str>,
    pub leading_format_family: Option<&'a str>,
    pub text_snippet: Option<&'a str>,
    /// A plain-text sibling representation's snippet, if the clip has one.
    /// Apps commonly capture both an HTML/RTF representation and a plain-text
    /// one for the same clip; the plain one is cheaper and more reliable to
    /// show than stripping markup, so it is preferred when present.
    pub plain_text_fallback: Option<&'a str>,
    pub has_thumbnail: bool,
    pub ocr_text: Option<&'a str>,
    pub file_name: Option<&'a str>,
    pub file_count: i64,
    pub facet_id: Option<&'a str>,
    pub facet_display_name: Option<&'a str>,
}

/// A valid extension compact presentation (one with a non-empty title) wholly
/// replaces the built-in preview. An icon-only presentation keeps the safe
/// built-in text while borrowing the leading visual from the selected view.
pub(crate) fn resolve_history_preview(
    ctx: PreviewContext<'_>,
    extension: Option<CompactPresentation>,
) -> HistoryPreview {
    if let Some(extension) = &extension {
        if let Some(title) = extension
            .title
            .as_ref()
            .filter(|title| !title.trim().is_empty())
        {
            return HistoryPreview {
                leading: extension.leading.clone(),
                title: title.clone(),
                subtitle: extension.subtitle.clone(),
                badge: extension.badge.clone(),
                accessibility_label: extension.accessibility_label.clone(),
            };
        }
    }
    let mut preview = build_builtin_preview(ctx);
    if let Some(extension) = extension {
        if !matches!(extension.leading, LeadingVisual::None) {
            preview.leading = extension.leading;
        }
        if extension.badge.is_some() {
            preview.badge = extension.badge;
        }
    }
    preview
}

pub(crate) fn build_builtin_preview(ctx: PreviewContext<'_>) -> HistoryPreview {
    let badge = ctx.facet_display_name.map(str::to_string);
    match ctx.presentation_kind {
        "image" => {
            let leading = if ctx.has_thumbnail {
                LeadingVisual::InputThumbnail
            } else {
                host_icon("file")
            };
            let title = ctx
                .ocr_text
                .and_then(normalize_snippet)
                .unwrap_or_else(|| image_title(ctx.leading_mime));
            finish(leading, title, None, None)
        }
        "files" => {
            let title = match (ctx.file_name, ctx.file_count) {
                (Some(name), count) if count <= 1 => name.to_string(),
                (_, count) if count > 1 => format!("{count} files"),
                _ => "Files".to_string(),
            };
            finish(host_icon("file"), title, None, None)
        }
        "document" => {
            let title = if ctx.leading_mime == Some("image/svg+xml") {
                "SVG image".to_string()
            } else {
                "PDF document".to_string()
            };
            finish(host_icon("file"), title, None, None)
        }
        "office" => finish(host_icon("file"), "Office document".to_string(), None, None),
        "rich_text" => {
            let title = ctx
                .plain_text_fallback
                .and_then(normalize_snippet)
                .or_else(|| {
                    ctx.text_snippet
                        .and_then(rtf_visible_text)
                        .and_then(|text| normalize_snippet(&text))
                })
                .unwrap_or_else(|| "Text".to_string());
            finish(host_icon("text"), title, None, None)
        }
        "html" => {
            let title = ctx
                .plain_text_fallback
                .and_then(normalize_snippet)
                .or_else(|| {
                    ctx.text_snippet
                        .map(html_visible_text)
                        .and_then(|text| normalize_snippet(&text))
                })
                .unwrap_or_else(|| "Text".to_string());
            let leading = facet_icon(ctx.facet_id).unwrap_or_else(|| host_icon("html"));
            finish(leading, title, None, badge)
        }
        "text" => {
            let title = ctx
                .text_snippet
                .and_then(normalize_snippet)
                .unwrap_or_else(|| "Text".to_string());
            let leading = facet_icon(ctx.facet_id).unwrap_or_else(|| host_icon("text"));
            finish(leading, title, None, badge)
        }
        _ => {
            let title = ctx
                .leading_format_family
                .filter(|family| !family.is_empty())
                .map(|family| format!("{} file", capitalize(family)))
                .unwrap_or_else(|| "Unsupported format".to_string());
            finish(host_icon("file"), title, None, None)
        }
    }
}

fn finish(
    leading: LeadingVisual,
    title: String,
    subtitle: Option<String>,
    badge: Option<String>,
) -> HistoryPreview {
    let accessibility_label = match &subtitle {
        Some(subtitle) => format!("{title}, {subtitle}"),
        None => title.clone(),
    };
    HistoryPreview {
        leading,
        title,
        subtitle,
        badge,
        accessibility_label,
    }
}

fn host_icon(name: &str) -> LeadingVisual {
    LeadingVisual::HostIcon { name: name.into() }
}

/// Maps a detected facet to a more specific host icon than the kind default.
/// Only facets with an unambiguous, catalog-approved icon are mapped; the rest
/// fall back to the caller's default (still shown via `badge`).
fn facet_icon(facet_id: Option<&str>) -> Option<LeadingVisual> {
    let name = match facet_id? {
        "core.text.code" => "code",
        "core.data.json" => "braces",
        "core.link.url" => "link",
        "core.contact.email" => "mail",
        "core.security.secret" => "key",
        "core.value.color" => "palette",
        "core.data.table" => "table",
        "core.file.path" => "folder",
        "core.time.date" => "calendar",
        "core.contact.phone" => "phone",
        "core.math.expression" => "sigma",
        "core.text.markdown" => "file_text",
        "core.value.number" => "hash",
        _ => return None,
    };
    Some(host_icon(name))
}

fn image_title(mime: Option<&str>) -> String {
    let label = crate::contributions::image_view_label(mime.unwrap_or_default());
    if label == "Image" {
        label.to_string()
    } else {
        format!("{label} image")
    }
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn normalize_snippet(text: &str) -> Option<String> {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_chars(trimmed, SNIPPET_MAX_CHARS))
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        let truncated: String = text.chars().take(max_chars).collect();
        format!("{truncated}\u{2026}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(presentation_kind: &str) -> PreviewContext<'_> {
        PreviewContext {
            presentation_kind,
            leading_mime: None,
            leading_format_family: None,
            text_snippet: None,
            plain_text_fallback: None,
            has_thumbnail: false,
            ocr_text: None,
            file_name: None,
            file_count: 0,
            facet_id: None,
            facet_display_name: None,
        }
    }

    #[test]
    fn never_falls_back_to_binary_or_file_content() {
        for kind in [
            "image",
            "files",
            "document",
            "office",
            "rich_text",
            "html",
            "text",
            "unsupported",
        ] {
            let preview = build_builtin_preview(ctx(kind));
            assert_ne!(preview.title, "Binary or file content");
            assert!(!preview.title.is_empty());
            assert!(!preview.accessibility_label.is_empty());
        }
    }

    #[test]
    fn text_kind_normalizes_whitespace_and_truncates() {
        let mut c = ctx("text");
        c.text_snippet = Some("  hello   world  \n\n again  ");
        let preview = build_builtin_preview(c);
        assert_eq!(preview.title, "hello world again");
    }

    #[test]
    fn html_extracts_visible_text_never_markup() {
        let mut c = ctx("html");
        c.text_snippet = Some("<p>Hello <script>evil()</script>world</p>");
        let preview = build_builtin_preview(c);
        assert_eq!(preview.title, "Hello world");
        assert!(!preview.title.contains("script"));
    }

    #[test]
    fn rich_text_extracts_visible_text_and_falls_back_on_unsafe_rtf() {
        let mut c = ctx("rich_text");
        c.text_snippet = Some(r#"{\rtf1\ansi Hello world.}"#);
        let preview = build_builtin_preview(c);
        assert!(preview.title.contains("Hello world"));

        let mut unsafe_ctx = ctx("rich_text");
        unsafe_ctx.text_snippet = Some(r#"{\rtf1\object\objdata unsafe}"#);
        let fallback = build_builtin_preview(unsafe_ctx);
        assert_eq!(fallback.title, "Text");
        assert!(!fallback.title.contains("\\object"));
    }

    #[test]
    fn html_prefers_plain_text_sibling_over_markup_extraction() {
        let mut c = ctx("html");
        c.text_snippet = Some("<div><span>should not be used</span></div>");
        c.plain_text_fallback = Some("the real plain-text sibling content");
        let preview = build_builtin_preview(c);
        assert_eq!(preview.title, "the real plain-text sibling content");
    }

    #[test]
    fn rich_text_prefers_plain_text_sibling_over_rtf_extraction() {
        let mut c = ctx("rich_text");
        c.text_snippet = Some(r#"{\rtf1\ansi should not be used.}"#);
        c.plain_text_fallback = Some("the real plain-text sibling content");
        let preview = build_builtin_preview(c);
        assert_eq!(preview.title, "the real plain-text sibling content");
    }

    #[test]
    fn image_prefers_ocr_text_then_format_label() {
        let mut with_ocr = ctx("image");
        with_ocr.ocr_text = Some("Recognized text");
        with_ocr.has_thumbnail = true;
        let preview = build_builtin_preview(with_ocr);
        assert_eq!(preview.title, "Recognized text");
        assert_eq!(preview.leading, LeadingVisual::InputThumbnail);

        let mut without_ocr = ctx("image");
        without_ocr.leading_mime = Some("image/png");
        let preview = build_builtin_preview(without_ocr);
        assert_eq!(preview.title, "PNG image");
    }

    #[test]
    fn files_shows_name_or_count() {
        let mut single = ctx("files");
        single.file_name = Some("report.pdf");
        single.file_count = 1;
        assert_eq!(build_builtin_preview(single).title, "report.pdf");

        let mut many = ctx("files");
        many.file_name = Some("report.pdf");
        many.file_count = 3;
        assert_eq!(build_builtin_preview(many).title, "3 files");
    }

    #[test]
    fn document_office_and_unsupported_get_meaningful_labels() {
        assert_eq!(build_builtin_preview(ctx("document")).title, "PDF document");
        let mut svg = ctx("document");
        svg.leading_mime = Some("image/svg+xml");
        assert_eq!(build_builtin_preview(svg).title, "SVG image");
        assert_eq!(
            build_builtin_preview(ctx("office")).title,
            "Office document"
        );
        let mut unsupported = ctx("unsupported");
        unsupported.leading_format_family = Some("binary");
        assert_eq!(build_builtin_preview(unsupported).title, "Binary file");
        assert_eq!(
            build_builtin_preview(ctx("unsupported")).title,
            "Unsupported format"
        );
    }

    #[test]
    fn valid_extension_title_replaces_builtin_result() {
        let extension = CompactPresentation {
            leading: LeadingVisual::Monogram { text: "AB".into() },
            title: Some("Custom title".into()),
            subtitle: Some("Custom subtitle".into()),
            badge: Some("Custom".into()),
            accessibility_label: "Custom accessible label".into(),
        };
        let preview = resolve_history_preview(ctx("text"), Some(extension));
        assert_eq!(preview.title, "Custom title");
        assert_eq!(
            preview.leading,
            LeadingVisual::Monogram { text: "AB".into() }
        );
    }

    #[test]
    fn extension_with_no_title_falls_back_to_builtin() {
        let mut c = ctx("text");
        c.text_snippet = Some("fallback text");
        let extension = CompactPresentation {
            leading: LeadingVisual::None,
            title: None,
            subtitle: None,
            badge: None,
            accessibility_label: "irrelevant".into(),
        };
        let preview = resolve_history_preview(c, Some(extension));
        assert_eq!(preview.title, "fallback text");
    }

    #[test]
    fn icon_only_extension_keeps_builtin_text_and_reuses_view_icon() {
        let mut c = ctx("text");
        c.text_snippet = Some("safe built-in text");
        let leading = LeadingVisual::PackageIcon {
            light: "data:image/svg+xml;base64,light".into(),
            dark: Some("data:image/svg+xml;base64,dark".into()),
            scale_percent: 100,
        };
        let extension = CompactPresentation {
            leading: leading.clone(),
            title: None,
            subtitle: None,
            badge: Some("Selected facet".into()),
            accessibility_label: "JWT view".into(),
        };

        let preview = resolve_history_preview(c, Some(extension));

        assert_eq!(preview.title, "safe built-in text");
        assert_eq!(preview.leading, leading);
        assert_eq!(preview.badge.as_deref(), Some("Selected facet"));
        assert_eq!(preview.accessibility_label, "safe built-in text");
    }

    #[test]
    fn extension_with_blank_title_falls_back_to_builtin() {
        let mut c = ctx("text");
        c.text_snippet = Some("fallback text");
        let extension = CompactPresentation {
            leading: LeadingVisual::None,
            title: Some("   ".into()),
            subtitle: None,
            badge: None,
            accessibility_label: "irrelevant".into(),
        };
        let preview = resolve_history_preview(c, Some(extension));
        assert_eq!(preview.title, "fallback text");
    }
}
