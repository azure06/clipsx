use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    Auto,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    List,
    Grid,
}

impl Default for ViewMode {
    fn default() -> Self {
        ViewMode::List
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RetentionPolicy {
    Unlimited,
    Days,
    Count,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        RetentionPolicy::Unlimited
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PasteFormat {
    Auto,
    Plain,
    Html,
    Markdown,
}

impl Default for PasteFormat {
    fn default() -> Self {
        PasteFormat::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    // General
    pub theme: Theme,
    pub view_mode: ViewMode,
    pub language: String,

    // Shortcuts
    pub global_shortcut: String,

    // Clipboard monitoring
    pub enable_images: bool,
    pub enable_files: bool,
    pub enable_rich_text: bool,
    pub excluded_apps: Vec<String>,

    // Storage & History
    pub history_limit: u32,
    pub retention_policy: RetentionPolicy,
    pub retention_value: u32,
    pub auto_delete_days: u32,
    pub max_image_size_mb: u32,

    // Privacy & Behavior
    pub auto_clear_minutes: u32,
    pub hide_on_copy: bool,
    pub clear_on_exit: bool,
    pub auto_start: bool,

    // Paste behavior
    pub default_paste_format: PasteFormat,
    pub auto_close_after_paste: bool,

    // Notifications
    pub show_copy_toast: bool,
    pub toast_duration_ms: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            view_mode: ViewMode::default(),
            language: "en".to_string(),
            global_shortcut: if cfg!(target_os = "macos") {
                "Cmd+Shift+V".to_string()
            } else {
                "Ctrl+Shift+V".to_string()
            },
            enable_images: true,
            enable_files: true,
            enable_rich_text: true,
            excluded_apps: vec![],
            history_limit: 1000,
            retention_policy: RetentionPolicy::default(),
            retention_value: 0,
            auto_delete_days: 0,
            max_image_size_mb: 10,
            auto_clear_minutes: 0,
            hide_on_copy: false,
            clear_on_exit: false,
            auto_start: false,
            default_paste_format: PasteFormat::default(),
            auto_close_after_paste: true,
            show_copy_toast: true,
            toast_duration_ms: 1500,
        }
    }
}
