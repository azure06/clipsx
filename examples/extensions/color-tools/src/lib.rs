mod bindings {
    use super::ColorTools;
    wit_bindgen::generate!({ path: "../../../src-tauri/wit", world: "extension" });
    export!(ColorTools);
}

use bindings::clipsx::extension::types::{
    ActionResult, CardField, CardModel, CompactModel, Content, Facet, GuestError,
    GuestErrorCode, LeadingVisual, OutputContent, OutputRepresentation, RenderModel,
    Representation, Rgba,
};

struct ColorTools;

#[derive(Clone, Copy)]
struct Color {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl bindings::Guest for ColorTools {
    fn detect(
        contribution_id: String,
        input: Representation,
    ) -> Result<Vec<Facet>, GuestError> {
        if contribution_id != "detect-color" {
            return Ok(Vec::new());
        }
        let Some(text) = text(&input) else { return Ok(Vec::new()) };
        let Some(color) = parse_color(text.trim()) else { return Ok(Vec::new()) };
        Ok(vec![Facet {
            id: "color".into(),
            payload_json: payload(color),
        }])
    }

    fn render_detail(
        contribution_id: String,
        input: Representation,
        _facet: Option<Facet>,
    ) -> Result<RenderModel, GuestError> {
        if contribution_id != "color-card" {
            return Err(unsupported("unknown renderer"));
        }
        let color = color_from_input(&input)?;
        Ok(RenderModel::Card(CardModel {
            leading: swatch(color),
            title: hex(color),
            subtitle: Some(rgb(color)),
            fields: vec![
                CardField { label: "HEX".into(), value: hex(color) },
                CardField { label: "RGB".into(), value: rgb(color) },
                CardField { label: "HSL".into(), value: hsl(color) },
            ],
        }))
    }

    fn render_compact(
        contribution_id: String,
        input: Representation,
        _facet: Option<Facet>,
    ) -> Result<CompactModel, GuestError> {
        if contribution_id != "color-card" {
            return Err(unsupported("unknown compact renderer"));
        }
        let color = color_from_input(&input)?;
        Ok(CompactModel {
            leading: swatch(color),
            title: Some(hex(color)),
            subtitle: Some(rgb(color)),
            badge: Some("Color".into()),
            accessibility_label: format!("Color {}", hex(color)),
        })
    }

    fn transform(
        contribution_id: String,
        input: Representation,
        parameters_json: String,
    ) -> Result<Vec<OutputRepresentation>, GuestError> {
        if contribution_id != "format-color" {
            return Err(unsupported("unknown transformer"));
        }
        let color = color_from_input(&input)?;
        let parameters: serde_json::Value = serde_json::from_str(&parameters_json)
            .map_err(|_| invalid("parameters must be JSON"))?;
        let output = match parameters.get("format").and_then(|value| value.as_str()) {
            Some("hex") => hex(color),
            Some("rgb") => rgb(color),
            Some("hsl") => hsl(color),
            _ => return Err(invalid("format must be hex, rgb, or hsl")),
        };
        Ok(vec![OutputRepresentation {
            format_key: "mime:text/plain".into(),
            mime_type: "text/plain".into(),
            content: OutputContent::Text(output),
        }])
    }

    fn run_action(
        _contribution_id: String,
        _input: Representation,
        _facet: Option<Facet>,
        _parameters_json: String,
    ) -> Result<ActionResult, GuestError> {
        Err(unsupported("Color Tools actions use transformer presets"))
    }
}

fn text(input: &Representation) -> Option<&str> {
    match &input.content { Content::Text(value) => Some(value), _ => None }
}

fn color_from_input(input: &Representation) -> Result<Color, GuestError> {
    text(input)
        .and_then(|value| parse_color(value.trim()))
        .ok_or_else(|| invalid("input is not a supported color"))
}

fn parse_color(value: &str) -> Option<Color> {
    parse_hex(value).or_else(|| parse_rgb(value)).or_else(|| parse_hsl(value))
}

fn parse_hex(value: &str) -> Option<Color> {
    let hex = value.strip_prefix('#')?;
    let expanded = match hex.len() {
        3 => hex.chars().flat_map(|ch| [ch, ch]).collect::<String>(),
        6 => hex.to_string(),
        _ => return None,
    };
    Some(Color {
        r: u8::from_str_radix(&expanded[0..2], 16).ok()?,
        g: u8::from_str_radix(&expanded[2..4], 16).ok()?,
        b: u8::from_str_radix(&expanded[4..6], 16).ok()?,
        a: 255,
    })
}

fn parse_rgb(value: &str) -> Option<Color> {
    let body = value.strip_prefix("rgb(")?.strip_suffix(')')?;
    let values: Vec<u8> = body
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter(|part| !part.is_empty())
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    (values.len() == 3).then(|| Color { r: values[0], g: values[1], b: values[2], a: 255 })
}

fn parse_hsl(value: &str) -> Option<Color> {
    let body = value.strip_prefix("hsl(")?.strip_suffix(')')?;
    let values: Vec<&str> = body
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect();
    if values.len() != 3 { return None }
    let h = values[0].parse::<f64>().ok()?.rem_euclid(360.0) / 360.0;
    let s = values[1].strip_suffix('%')?.parse::<f64>().ok()? / 100.0;
    let l = values[2].strip_suffix('%')?.parse::<f64>().ok()? / 100.0;
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let channel = |mut t: f64| {
        if t < 0.0 { t += 1.0 }
        if t > 1.0 { t -= 1.0 }
        let value = if t < 1.0 / 6.0 { p + (q - p) * 6.0 * t }
            else if t < 0.5 { q }
            else if t < 2.0 / 3.0 { p + (q - p) * (2.0 / 3.0 - t) * 6.0 }
            else { p };
        (value * 255.0).round() as u8
    };
    Some(Color { r: channel(h + 1.0 / 3.0), g: channel(h), b: channel(h - 1.0 / 3.0), a: 255 })
}

fn hex(color: Color) -> String { format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b) }
fn rgb(color: Color) -> String { format!("rgb({} {} {})", color.r, color.g, color.b) }
fn hsl(color: Color) -> String {
    let r = color.r as f64 / 255.0;
    let g = color.g as f64 / 255.0;
    let b = color.b as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    let delta = max - min;
    let (h, s) = if delta == 0.0 { (0.0, 0.0) } else {
        let s = delta / (1.0 - (2.0 * l - 1.0).abs());
        let h = if max == r { 60.0 * ((g - b) / delta).rem_euclid(6.0) }
            else if max == g { 60.0 * ((b - r) / delta + 2.0) }
            else { 60.0 * ((r - g) / delta + 4.0) };
        (h, s)
    };
    format!("hsl({:.0} {:.0}% {:.0}%)", h, s * 100.0, l * 100.0)
}

fn swatch(color: Color) -> LeadingVisual {
    LeadingVisual::Swatch(Rgba { red: color.r, green: color.g, blue: color.b, alpha: color.a })
}

fn payload(color: Color) -> String {
    serde_json::json!({
        "schemaVersion": 1,
        "hex": hex(color),
        "rgb": rgb(color),
        "hsl": hsl(color),
        "red": color.r,
        "green": color.g,
        "blue": color.b,
        "alpha": color.a,
    }).to_string()
}

fn invalid(message: &str) -> GuestError {
    GuestError { code: GuestErrorCode::InvalidInput, message: message.into() }
}
fn unsupported(message: &str) -> GuestError {
    GuestError { code: GuestErrorCode::Unsupported, message: message.into() }
}
