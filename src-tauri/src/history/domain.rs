use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::contracts::HistoryPreview;

/// Device-local normal window content size, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct NormalWindowSize {
    pub width: f64,
    pub height: f64,
}

impl Default for NormalWindowSize {
    fn default() -> Self {
        Self {
            width: 1100.0,
            height: 600.0,
        }
    }
}

impl NormalWindowSize {
    pub fn is_valid(self) -> bool {
        self.width.is_finite() && self.height.is_finite() && self.width > 0.0 && self.height > 0.0
    }

    pub fn approximately_eq(self, other: Self) -> bool {
        (self.width - other.width).abs() < 1.0 && (self.height - other.height).abs() < 1.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSettings {
    pub max_ordinary_clips: Option<u32>,
    pub max_age_days: Option<u32>,
    pub max_managed_bytes: Option<u64>,
    pub max_representation_bytes: Option<u64>,
    pub max_snapshot_bytes: Option<u64>,
    #[serde(default, skip_deserializing)]
    pub managed_bytes_used: u64,
    #[serde(default, skip_deserializing)]
    pub retention_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFilters {
    pub images: bool,
    pub files: bool,
    pub rich_text: bool,
    pub office_and_documents: bool,
}

impl Default for CaptureFilters {
    fn default() -> Self {
        Self {
            images: true,
            files: true,
            rich_text: true,
            office_and_documents: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivationMode {
    SingleClickCopy,
    DoubleClickPrimary,
    SelectOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DefaultOutputFormat {
    Original,
    PlainText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub language_initialized: bool,
    pub activation_mode: ActivationMode,
    pub default_output_format: DefaultOutputFormat,
    pub paste_on_enter: bool,
    pub hide_on_copy: bool,
    pub hide_on_blur: bool,
    pub always_on_top: bool,
    pub show_copy_toast: bool,
    pub auto_clear_minutes: Option<u32>,
    pub clear_on_exit: bool,
    pub auto_start: bool,
    pub verbose_logging_enabled: bool,
    pub error_reporting_enabled: bool,
    /// Empty disables the global shortcut; an absent saved value uses the platform default.
    pub global_shortcut: String,
    pub excluded_apps: Vec<String>,
    pub capture_filters: CaptureFilters,
    pub capture: CaptureSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "en".into(),
            language_initialized: false,
            activation_mode: ActivationMode::DoubleClickPrimary,
            default_output_format: DefaultOutputFormat::Original,
            paste_on_enter: false,
            hide_on_copy: false,
            hide_on_blur: false,
            always_on_top: false,
            show_copy_toast: true,
            auto_clear_minutes: None,
            clear_on_exit: false,
            auto_start: false,
            verbose_logging_enabled: false,
            error_reporting_enabled: true,
            global_shortcut: default_global_shortcut(std::env::consts::OS).into(),
            excluded_apps: vec![],
            capture_filters: CaptureFilters::default(),
            capture: CaptureSettings::default(),
        }
    }
}
fn default_global_shortcut(os: &str) -> &'static str {
    match os {
        "macos" => "Cmd+Ctrl+V",
        _ => "Ctrl+Alt+V",
    }
}

impl AppSettings {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            bail!("theme is invalid");
        }
        if !matches!(self.language.as_str(), "en" | "ja")
            || self.language.is_empty()
            || self.language.len() > 35
            || !self
                .language
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            bail!("language is invalid");
        }
        if self.global_shortcut.len() > 128 {
            bail!("global shortcut is invalid");
        }
        if !self.global_shortcut.is_empty() {
            self.global_shortcut
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                .map_err(|_| anyhow::anyhow!("global shortcut is invalid"))?;
        }
        if self.excluded_apps.len() > 256
            || self.excluded_apps.iter().any(|value| {
                value.is_empty() || value.len() > 512 || value.chars().any(char::is_control)
            })
        {
            bail!("excluded application list is invalid");
        }
        if self
            .auto_clear_minutes
            .is_some_and(|value| !matches!(value, 5 | 15 | 30 | 60))
        {
            bail!("auto-clear interval is invalid");
        }
        if self.capture.max_ordinary_clips == Some(0)
            || self.capture.max_age_days == Some(0)
            || self.capture.max_representation_bytes == Some(0)
            || self.capture.max_snapshot_bytes == Some(0)
            || self.capture.max_managed_bytes == Some(0)
            || self
                .capture
                .max_ordinary_clips
                .is_some_and(|value| value > 100_000)
            || self.capture.max_age_days.is_some_and(|value| value > 3_650)
            || self
                .capture
                .max_representation_bytes
                .is_some_and(|value| value > 52_428_800)
            || self
                .capture
                .max_snapshot_bytes
                .is_some_and(|value| value > 104_857_600)
            || self
                .capture
                .max_managed_bytes
                .is_some_and(|value| value > 1_099_511_627_776)
        {
            bail!("capture limit is outside the supported range");
        }
        Ok(())
    }
}
impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            max_ordinary_clips: Some(1000),
            max_age_days: None,
            max_managed_bytes: Some(1_073_741_824),
            max_representation_bytes: Some(52_428_800),
            max_snapshot_bytes: Some(104_857_600),
            managed_bytes_used: 0,
            retention_warning: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_shortcut_defaults_match_each_platform() {
        for (os, expected) in [
            ("macos", "Cmd+Ctrl+V"),
            ("windows", "Ctrl+Alt+V"),
            ("linux", "Ctrl+Alt+V"),
        ] {
            assert_eq!(default_global_shortcut(os), expected);
            assert!(expected
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                .is_ok());
        }
        assert_eq!(
            AppSettings::default().global_shortcut,
            default_global_shortcut(std::env::consts::OS)
        );
    }

    #[test]
    fn global_shortcut_can_be_disabled_but_invalid_bindings_are_rejected() {
        let mut settings = AppSettings::default();
        settings.global_shortcut.clear();
        assert!(settings.validate().is_ok());
        for invalid in [" ", "invalid shortcut!", &"V".repeat(129)] {
            settings.global_shortcut = invalid.into();
            assert!(settings.validate().is_err());
        }
    }

    #[test]
    fn app_settings_defaults_to_copy_only_double_click_activation() {
        let settings = AppSettings::default();

        assert!(matches!(
            settings.activation_mode,
            ActivationMode::DoubleClickPrimary
        ));
        assert!(!settings.paste_on_enter);
        assert!(!settings.hide_on_copy);
        assert!(!settings.hide_on_blur);
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    pub id: String,
    pub source_app_name: Option<String>,
    pub source_app_id: Option<String>,
    pub source_app_platform: Option<String>,
    pub captured_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub note: Option<String>,
    pub tags: Vec<Tag>,
    pub history_preview: HistoryPreview,
    pub representation_count: i64,
    pub primary_presentation_kind: String,
    pub thumbnail_asset_id: Option<String>,
    pub has_plain_text: bool,
    pub shareable: bool,
    pub has_embedding: bool,
    pub ocr_status: Option<String>,
    #[serde(skip)]
    pub history_renderer_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPage {
    pub items: Vec<ClipSummary>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDetail {
    pub clip: ClipSummary,
    pub representations: Vec<RepresentationDetail>,
    pub format_observations: Vec<FormatObservation>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepresentationDetail {
    pub id: String,
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub storage_kind: String,
    pub ordinal: i64,
    pub capture_priority: i64,
    pub byte_length: i64,
    pub text_value: Option<String>,
    pub file_references: Vec<String>,
    pub binary_file_id: Option<String>,
    pub sha256: Option<String>,
    pub capability_id: String,
    pub format_family: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FormatObservation {
    pub ordinal: i64,
    pub platform: String,
    pub native_identifier: String,
    pub numeric_id: Option<i64>,
    pub medium: Option<String>,
    pub byte_length: Option<i64>,
    pub capability_id: Option<String>,
    pub policy_version: i64,
    pub decision: String,
    pub reason: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub scope: Option<String>,
    pub tag_id: Option<String>,
}
#[derive(Debug, Clone)]
pub enum CapturedPayload {
    Text(String),
    Binary(Vec<u8>),
    Files(Vec<String>),
}
#[derive(Debug, Clone)]
pub struct CapturedRepresentation {
    pub format_key: String,
    pub canonical_mime_type: Option<String>,
    pub native_type: Option<String>,
    pub platform: String,
    pub capture_priority: i64,
    pub payload: CapturedPayload,
}
#[derive(Debug, Clone)]
pub struct CapturedSnapshot {
    pub token: u64,
    pub source_app_name: Option<String>,
    pub source_app_id: Option<String>,
    pub representations: Vec<CapturedRepresentation>,
    pub format_observations: Vec<FormatObservation>,
}
