use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum Theme {
    Light,
    Dark,
    #[default]
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
#[allow(dead_code)]
pub enum ViewMode {
    #[default]
    List,
    Grid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum PasteFormat {
    #[default]
    Auto,
    Plain,
    Html,
    Markdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ItemActivationMode {
    #[default]
    SingleClickCopy,
    DoubleClickPrimary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    // General
    pub theme: Theme,
    pub language: String,

    // Shortcuts
    pub global_shortcut: String,

    // Clipboard monitoring
    pub enable_images: bool,
    pub enable_files: bool,
    pub enable_rich_text: bool,
    pub enable_office_formats: bool,
    pub excluded_apps: Vec<String>,

    // Storage & History
    /// 0 = unlimited
    #[serde(default = "default_max_clips")]
    pub max_clips: u32,
    /// 0 = never delete by age
    #[serde(default)]
    pub max_age_days: u32,
    pub max_item_size_mb: u32,

    // Privacy & Behavior
    pub auto_clear_minutes: u32,
    pub hide_on_copy: bool,
    pub clear_on_exit: bool,
    pub auto_start: bool,

    // Paste behavior
    pub default_paste_format: PasteFormat,
    #[serde(default = "default_true")]
    pub paste_on_enter: bool,
    #[serde(default = "default_item_activation_mode")]
    pub item_activation_mode: ItemActivationMode,
    #[serde(default = "default_true")]
    pub hide_on_blur: bool,
    #[serde(default = "default_false")]
    pub always_on_top: bool,

    // Notifications
    pub show_copy_toast: bool,

    // Onboarding
    #[serde(default = "default_false")]
    pub has_seen_welcome: bool,

    // Plugins
    #[serde(default = "default_false")]
    pub semantic_search_enabled: bool,
    #[serde(default = "default_semantic_model")]
    pub semantic_model: String,
}

fn default_semantic_model() -> String {
    "paraphrase-multilingual-MiniLM-L12-v2".to_string()
}

fn default_item_activation_mode() -> ItemActivationMode {
    ItemActivationMode::SingleClickCopy
}

fn default_max_clips() -> u32 {
    1000
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            language: "en".to_string(),
            global_shortcut: if cfg!(target_os = "macos") {
                "Cmd+Shift+V".to_string()
            } else {
                "Ctrl+Shift+V".to_string()
            },
            enable_images: true,
            enable_files: true,
            enable_rich_text: true,
            enable_office_formats: true,
            excluded_apps: vec![],
            max_clips: 1000,
            max_age_days: 0,
            max_item_size_mb: 10,
            auto_clear_minutes: 0,
            hide_on_copy: false,
            clear_on_exit: false,
            auto_start: false,
            default_paste_format: PasteFormat::default(),
            paste_on_enter: true,
            item_activation_mode: default_item_activation_mode(),
            hide_on_blur: true,
            always_on_top: false,
            show_copy_toast: true,
            has_seen_welcome: false,
            semantic_search_enabled: false,
            semantic_model: "paraphrase-multilingual-MiniLM-L12-v2".to_string(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}
