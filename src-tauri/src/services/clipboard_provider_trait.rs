use crate::services::clipboard_platform::ClipboardContent;
use anyhow::Result;

/// Trait for platform-specific clipboard operations
/// This allows us to mock the clipboard in tests (dependency injection)
pub trait ClipboardProvider: Send + Sync {
    /// Read current clipboard content
    fn read_clipboard(&self) -> Result<Option<ClipboardContent>>;

    /// Get the name of the active application (source of copy)
    fn get_active_app_name(&self) -> Option<String>;

    /// Get change count (macOS optimized) or -1 if not supported
    fn get_change_count(&self) -> Result<i64>;

    /// Get platform name
    fn platform_name(&self) -> &'static str;
}
