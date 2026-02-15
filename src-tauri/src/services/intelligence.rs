use lazy_static::lazy_static;
use regex::Regex;
use serde_json::json;

/// Result of intelligence analysis
pub struct DetectionResult {
    pub detected_type: String,
    pub metadata: Option<String>,
}

pub struct IntelligenceService;

impl IntelligenceService {
    pub fn detect(text: &str) -> DetectionResult {
        let trimmed = text.trim();

        // 1. URL Detection
        if let Some(meta) = Self::detect_url(trimmed) {
            return DetectionResult {
                detected_type: "url".to_string(),
                metadata: Some(meta.to_string()),
            };
        }

        // 2. Color Detection
        if let Some(meta) = Self::detect_color(trimmed) {
            return DetectionResult {
                detected_type: "color".to_string(),
                metadata: Some(meta.to_string()),
            };
        }

        // 3. Email Detection
        if let Some(meta) = Self::detect_email(trimmed) {
            return DetectionResult {
                detected_type: "email".to_string(),
                metadata: Some(meta.to_string()),
            };
        }

        // 4. Code Detection (Heuristic)
        if let Some(meta) = Self::detect_code(trimmed) {
            return DetectionResult {
                detected_type: "code".to_string(),
                metadata: Some(meta.to_string()),
            };
        }

        // Default: Text
        DetectionResult {
            detected_type: "text".to_string(),
            metadata: Some(
                json!({
                    "line_count": text.lines().count(),
                    "word_count": text.split_whitespace().count(),
                })
                .to_string(),
            ),
        }
    }

    fn detect_url(text: &str) -> Option<serde_json::Value> {
        lazy_static! {
            static ref URL_REGEX: Regex = Regex::new(r"^(https?://[^\s$.?#].[^\s]*)$").unwrap();
        }

        if URL_REGEX.is_match(text) {
            // Strip tracking params (basic)
            let clean_url = text.split('?').next().unwrap_or(text);

            // Note: Real stripping logic can be more complex, keeping essential query params
            // For now, let's strictly matching the frontend logic or improve it.
            // The frontend logic was: new URL(trimmed) -> valid?

            if let Ok(url) = url::Url::parse(text) {
                return Some(json!({
                    "url": text,
                    "domain": url.domain(),
                    "protocol": url.scheme(),
                }));
            }
        }
        None
    }

    fn detect_color(text: &str) -> Option<serde_json::Value> {
        lazy_static! {
            static ref HEX_REGEX: Regex =
                Regex::new(r"^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$").unwrap();
            static ref RGB_REGEX: Regex =
                Regex::new(r"^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*(?:\.\d+)?))?\)").unwrap();
        }

        if HEX_REGEX.is_match(text) {
            return Some(json!({
                "hex": text.to_uppercase(),
                "type": "hex"
            }));
        }

        if RGB_REGEX.is_match(text) {
            return Some(json!({
                "type": "rgb",
                "original": text
            }));
        }
        None
    }

    fn detect_email(text: &str) -> Option<serde_json::Value> {
        lazy_static! {
            static ref EMAIL_REGEX: Regex =
                Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
        }

        if EMAIL_REGEX.is_match(text) {
            let domain = text.split('@').nth(1).unwrap_or("");
            return Some(json!({
                "email": text,
                "domain": domain
            }));
        }
        None
    }

    fn detect_code(text: &str) -> Option<serde_json::Value> {
        // Simple heuristic: look for structural chars and keywords
        let keywords = [
            "const ", "let ", "fn ", "pub ", "import ", "export ", "class ", "def ", "return ",
            "impl ",
        ];
        let structural = ["{", "}", "(", ")", ";", "=>"];

        if text.len() < 20 {
            return None;
        }

        let score = keywords.iter().filter(|k| text.contains(**k)).count() * 2
            + structural.iter().filter(|s| text.contains(**s)).count();

        if score > 3 {
            return Some(json!({
                "language": "unknown", // Todo: better inference
                "score": score
            }));
        }
        None
    }
}
