use super::SyncRemoteRecord;
use serde_json::Value;

pub const PROFILE_KEYS: &[&str] = &[
    "ui.theme",
    "ui.language",
    "ui.default_output_format",
    "ui.show_copy_toast",
    "search.syntax_mode",
    "search.enabled_sources",
    "artifacts.ocr.enabled",
    "artifacts.ocr.language",
];
fn identifier(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.:/-".contains(&b))
}
pub fn valid_record(r: &SyncRemoteRecord) -> bool {
    if r.key.is_empty()
        || r.key.len() > 512
        || r.revision_physical_ms < 0
        || r.revision_counter < 0
        || r.payload
            .as_ref()
            .is_some_and(|v| v.to_string().len() > 65536)
    {
        return false;
    }
    let known = match r.kind.as_str() {
        "profile_setting" => PROFILE_KEYS.contains(&r.key.as_str()),
        "renderer_preference" => r.key.split_once(':').is_some_and(|(p, k)| {
            matches!(p, "mime" | "facet" | "capability")
                && !k.is_empty()
                && k.len() <= 256
                && !k.chars().any(char::is_control)
        }),
        "extension_intent" => {
            identifier(&r.key, 256) && r.key.contains('.') && !r.key.contains('/')
        }
        "extension_setting" => r
            .key
            .split_once('/')
            .is_some_and(|(p, k)| identifier(p, 256) && identifier(k, 128) && !k.contains('/')),
        "shortcut" => identifier(&r.key, 256) && r.key != "window.global_shortcut",
        _ => false,
    };
    if !known {
        return false;
    }
    if r.tombstone {
        return r.payload.is_none();
    }
    let Some(v) = r.payload.as_ref() else {
        return false;
    };
    match r.kind.as_str() {
        "profile_setting" => match r.key.as_str() {
            "ui.theme" => v
                .as_str()
                .is_some_and(|s| matches!(s, "system" | "light" | "dark")),
            "ui.language" | "artifacts.ocr.language" => v.as_str().is_some_and(|s| {
                !s.is_empty()
                    && s.len() <= 35
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            }),
            "ui.default_output_format" => v
                .as_str()
                .is_some_and(|s| matches!(s, "plain_text" | "original")),
            "search.syntax_mode" => v
                .as_str()
                .is_some_and(|s| matches!(s, "simple" | "advanced")),
            "search.enabled_sources" => v.as_array().is_some_and(|a| {
                a.len() <= 32
                    && a.iter()
                        .all(|v| v.as_str().is_some_and(|s| identifier(s, 160)))
            }),
            _ => v.is_boolean(),
        },
        "renderer_preference" => v.as_str().is_some_and(|s| identifier(s, 256)),
        "extension_intent" => v
            .as_object()
            .is_some_and(|o| o.len() == 1 && o.get("enabled").is_some_and(Value::is_boolean)),
        // Application requires a matching signed manifest declaration as well.
        "extension_setting" => v.is_boolean() || v.is_number(),
        "shortcut" => v.as_str().is_some_and(valid_shortcut),
        _ => false,
    }
}
pub fn valid_shortcut(s: &str) -> bool {
    let mut parts = s.split('+').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            return !part.is_empty()
                && part.len() <= 24
                && part.bytes().all(|b| b.is_ascii_alphanumeric());
        }
        if !matches!(part, "Primary" | "Ctrl" | "Alt" | "Shift" | "Meta") {
            return false;
        }
    }
    false
}
