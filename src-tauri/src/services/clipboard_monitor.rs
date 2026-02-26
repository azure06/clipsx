use super::clipboard_platform::{self, ClipboardContent};
use super::clipboard_provider_trait::ClipboardProvider;
use anyhow::Result;

/// Result of checking clipboard: either unchanged, or new content with hash
///
/// JS/TS equivalent: type ClipboardCheckResult =
///   | { type: 'unchanged' }
///   | { type: 'changed', content: ClipboardContent, hash: string }
pub enum ClipboardCheckResult {
    Unchanged,
    Changed {
        content: ClipboardContent,
        hash: String,
        source_app: Option<String>,
    },
}

/// Trait for platform-specific clipboard change detection
///
/// JS/TS equivalent: interface ClipboardMonitor {
///   check(): Result<ClipboardCheckResult>
///   platformName(): string
/// }
///
/// NOTE: `Send + Sync` means this can be safely shared across threads
/// (required for async/tokio, no direct JS equivalent)
pub trait ClipboardMonitor: Send + Sync {
    /// Check clipboard and return content only if changed
    /// This is the single entry point - handles both detection and reading
    ///
    /// NOTE: `&mut self` means we can modify internal state (like last_hash)
    /// JS equivalent: check() { this.lastHash = ... }
    fn check(&mut self) -> Result<ClipboardCheckResult>;

    /// Platform name for logging
    ///
    /// NOTE: `&'static str` is a string literal that lives for entire program
    /// JS equivalent: platformName(): string (but the string is hardcoded)
    fn platform_name(&self) -> &'static str;

    /// Called after ClipsX programmatically writes content to the clipboard
    /// so the next monitor tick treats it as "unchanged" and doesn't create a
    /// duplicate entry.
    fn notify_wrote(&mut self, content: &ClipboardContent);
}

/// macOS monitor using NSPasteboard.changeCount (fast path)
///
/// JS/TS equivalent: class MacOSMonitor {
///   private lastChangeCount: number = 0
/// }
#[allow(dead_code)]
pub struct MacOSMonitor {
    last_change_count: i64,
    /// Hash of the content we expect to see on the next tick after a programmatic
    /// write. If it matches we return Unchanged to suppress phantom new entries.
    last_wrote_hash: Option<String>,
    provider: Box<dyn ClipboardProvider>,
}

#[allow(dead_code)]
impl MacOSMonitor {
    pub fn new(provider: Box<dyn ClipboardProvider>) -> Self {
        // NOTE: `Self` is shorthand for `MacOSMonitor`
        // JS equivalent: constructor() { this.lastChangeCount = 0 }
        Self {
            last_change_count: 0,
            last_wrote_hash: None,
            provider,
        }
    }
}

// NOTE: `impl Trait for Type` is how we implement interfaces in Rust
// JS equivalent: class MacOSMonitor implements ClipboardMonitor { ... }
impl ClipboardMonitor for MacOSMonitor {
    fn check(&mut self) -> Result<ClipboardCheckResult> {
        // Fast path: check changeCount first (1 syscall, ~1μs)
        let current = self.provider.get_change_count()?;

        if current > 0 && current == self.last_change_count {
            return Ok(ClipboardCheckResult::Unchanged);
        }

        let content = match self.provider.read_clipboard()? {
            Some(c) => c,
            None => return Ok(ClipboardCheckResult::Unchanged),
        };

        let hash = compute_content_hash(&content);

        // If ClipsX just wrote this content, suppress re-ingestion
        if let Some(ref wrote_hash) = self.last_wrote_hash {
            if &hash == wrote_hash {
                self.last_change_count = current;
                self.last_wrote_hash = None;
                return Ok(ClipboardCheckResult::Unchanged);
            }
        }
        self.last_wrote_hash = None;

        self.last_change_count = current;

        Ok(ClipboardCheckResult::Changed {
            content,
            hash,
            source_app: self.provider.get_active_app_name(),
        })
    }

    fn platform_name(&self) -> &'static str {
        "macOS"
    }

    fn notify_wrote(&mut self, content: &ClipboardContent) {
        // Read the changeCount AFTER the write just completed.
        // The next monitor tick will see current == last_change_count and return
        // Unchanged immediately — no clipboard read, no hash comparison needed.
        // This is more reliable than the old -1/hash approach for complex formats
        // like Office where the read-back hash may differ from what we wrote.
        if let Ok(new_count) = self.provider.get_change_count() {
            self.last_change_count = new_count;
        } else {
            // Fallback: -1 forces re-read; hash comparison will suppress re-capture
            self.last_change_count = -1;
        }

        // Keep hash as backup for the -1 fallback case
        self.last_wrote_hash = Some(compute_content_hash(content));
    }
}

/// Windows/Linux monitor using content hash comparison (no native change detection)
///
/// KEY DIFFERENCE: Stores hash in memory to avoid DB queries on unchanged clipboard
///
/// Flow:
/// 1. Read clipboard (no fast path available)
/// 2. Compute hash
/// 3. Compare with last_hash in memory
/// 4. If same → return Unchanged (NO DB QUERY)
/// 5. If different → update last_hash and return Changed
pub struct PollingMonitor {
    // NOTE: `Option<String>` is like `string | null` in TypeScript
    // None = no hash yet, Some(hash) = we have a hash
    last_hash: Option<String>,
    provider: Box<dyn ClipboardProvider>,
}

impl PollingMonitor {
    pub fn new(provider: Box<dyn ClipboardProvider>) -> Self {
        // NOTE: Start with None (no hash stored yet)
        Self {
            last_hash: None,
            provider,
        }
    }
}

impl ClipboardMonitor for PollingMonitor {
    fn check(&mut self) -> Result<ClipboardCheckResult> {
        // No fast path: must read clipboard every time (Windows/Linux limitation)
        let content = match self.provider.read_clipboard()? {
            Some(c) => c,
            None => return Ok(ClipboardCheckResult::Unchanged),
        };

        // Compute hash and compare with last known hash (in-memory check)
        let hash = compute_content_hash(&content);

        // NOTE: `if let` is pattern matching for Option
        // JS equivalent: if (this.lastHash !== null) { if (hash === this.lastHash) ... }
        //
        // `ref` means we borrow the value inside Option without taking ownership
        // Without `ref`, we'd move the String out of Option (not allowed)
        if let Some(ref last) = self.last_hash {
            if &hash == last {
                // Same hash = same content, no DB query needed
                // THIS IS THE KEY OPTIMIZATION: Skip DB entirely
                return Ok(ClipboardCheckResult::Unchanged);
            }
        }

        // Hash changed: update memory and return new content
        // NOTE: `.clone()` creates a copy of the String
        // Rust doesn't allow using `hash` after moving it, so we clone
        // JS equivalent: this.lastHash = hash (JS copies automatically)
        self.last_hash = Some(hash.clone());

        Ok(ClipboardCheckResult::Changed {
            content,
            hash,
            source_app: self.provider.get_active_app_name(),
        })
    }

    fn platform_name(&self) -> &'static str {
        #[cfg(target_os = "windows")]
        return "Windows";

        #[cfg(target_os = "linux")]
        return "Linux";

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        return "Unknown";
    }

    fn notify_wrote(&mut self, content: &ClipboardContent) {
        // Pre-seed last_hash with the hash of the content we just wrote.
        // The next check() call will compute the same hash and return Unchanged.
        // This works for all content types (text, HTML, images, Office, etc.)
        self.last_hash = Some(compute_content_hash(content));
    }
}

/// Compute hash for clipboard content
///
/// NOTE: `&ClipboardContent` means we borrow the content (read-only access)
/// JS equivalent: function computeHash(content: ClipboardContent): string
/// (but in JS, everything is passed by reference automatically)
fn compute_content_hash(content: &ClipboardContent) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    // NOTE: `match` is exhaustive - compiler ensures we handle all variants
    // JS equivalent: switch(content.type) { ... } but type-safe
    match content {
        // NOTE: Destructuring enum variants
        ClipboardContent::Text { content } => {
            let mut hasher = DefaultHasher::new();
            content.hash(&mut hasher);
            // NOTE: `{:x}` formats as hexadecimal
            format!("{:x}", hasher.finish())
        }
        // Hash the plain text, NOT the raw HTML/RTF markup.
        // This ensures the same human-readable content produces the same hash
        // regardless of whether it was copied from a rich-text or plain-text source.
        ClipboardContent::Html { plain, .. } => {
            let mut hasher = DefaultHasher::new();
            plain.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        }
        ClipboardContent::Rtf { plain, .. } => {
            let mut hasher = DefaultHasher::new();
            plain.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        }
        ClipboardContent::Image { data, .. } => {
            // Normalize image to pixels before hashing (ignore metadata)
            compute_image_hash(data)
        }
        ClipboardContent::Files { paths } => {
            let mut hasher = DefaultHasher::new();
            paths.join("|").hash(&mut hasher);
            format!("{:x}", hasher.finish())
        }
        // Hash Office content with priority (richest format first):
        // 1. Text (semantic deduplication)
        // 2. PDF (document with text layer)
        // 3. SVG (vector graphics)
        // 4. PNG (raster image)
        // 5. OLE (binary fallback)
        ClipboardContent::Office {
            extracted_text,
            pdf_data,
            svg_data,
            png_data,
            ole_data,
            ..
        } => {
            if !extracted_text.is_empty() {
                // Priority 1: Hash text for semantic deduplication
                let mut hasher = DefaultHasher::new();
                extracted_text.hash(&mut hasher);
                format!("{:x}", hasher.finish())
            } else if let Some(pdf) = pdf_data {
                // Priority 2: Hash PDF (richer than SVG/PNG)
                let mut hasher = DefaultHasher::new();
                pdf.hash(&mut hasher);
                format!("{:x}", hasher.finish())
            } else if let Some(svg) = svg_data {
                // Priority 3: Hash SVG (vector graphics)
                let mut hasher = DefaultHasher::new();
                svg.hash(&mut hasher);
                format!("{:x}", hasher.finish())
            } else if let Some(png) = png_data {
                // Priority 4: Hash PNG pixels (visual deduplication)
                compute_image_hash(png)
            } else if let Some(ole) = ole_data {
                // Priority 5: Hash OLE binary data (fallback)
                let mut hasher = DefaultHasher::new();
                ole.hash(&mut hasher);
                format!("{:x}", hasher.finish())
            } else {
                // No data at all (shouldn't happen): hash empty string
                let mut hasher = DefaultHasher::new();
                "".hash(&mut hasher);
                format!("{:x}", hasher.finish())
            }
        }
    }
}

/// Compute hash for image data by normalizing to raw pixels
///
/// WHY: Image metadata (EXIF, timestamps) changes on each clipboard read,
/// causing false duplicates. We decode to raw pixels to get stable hash.
///
/// NOTE: `&[u8]` is a slice (view into array) of bytes
/// JS equivalent: function computeImageHash(imageBytes: Uint8Array): string
fn compute_image_hash(image_bytes: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    // NOTE: `match` on Result<T, E> is like try/catch
    // JS equivalent: try { const img = decodeImage(bytes) } catch { ... }
    match image::load_from_memory(image_bytes) {
        Ok(img) => {
            let mut hasher = DefaultHasher::new();
            // Hash dimensions + raw pixel data (not encoded format)
            img.width().hash(&mut hasher);
            img.height().hash(&mut hasher);
            // NOTE: `.to_rgba8()` converts to raw pixels, `.as_raw()` gets byte array
            img.to_rgba8().as_raw().hash(&mut hasher);
            format!("{:x}", hasher.finish())
        }
        Err(_) => {
            // Fallback: hash raw bytes if decoding fails
            let mut hasher = DefaultHasher::new();
            image_bytes.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        }
    }
}

/// Create platform-specific monitor
///
/// NOTE: `Box<dyn Trait>` is heap-allocated trait object (like polymorphism)
/// JS equivalent: function createMonitor(): ClipboardMonitor
/// (but in JS, all objects are heap-allocated by default)
///
/// `dyn` means "dynamic dispatch" - runtime polymorphism
/// Without `dyn`, Rust uses static dispatch (compile-time, faster)
/// Implementation of ClipboardProvider that uses real system calls
pub struct RealClipboardProvider {
    app_handle: tauri::AppHandle,
}

impl RealClipboardProvider {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl ClipboardProvider for RealClipboardProvider {
    fn read_clipboard(&self) -> Result<Option<ClipboardContent>> {
        clipboard_platform::read_clipboard(&self.app_handle)
    }

    fn get_active_app_name(&self) -> Option<String> {
        clipboard_platform::get_active_app_name()
    }

    fn get_change_count(&self) -> Result<i64> {
        clipboard_platform::get_change_count()
    }

    fn platform_name(&self) -> &'static str {
        #[cfg(target_os = "macos")]
        return "macOS";
        #[cfg(target_os = "windows")]
        return "Windows";
        #[cfg(target_os = "linux")]
        return "Linux";
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        return "Unknown";
    }
}

pub fn create_monitor(app_handle: tauri::AppHandle) -> Box<dyn ClipboardMonitor> {
    let provider = Box::new(RealClipboardProvider::new(app_handle));

    // NOTE: `#[cfg(...)]` is compile-time conditional compilation
    // JS equivalent: if (process.platform === 'darwin') { ... }
    // But this happens at compile time, not runtime
    #[cfg(target_os = "macos")]
    {
        Box::new(MacOSMonitor::new(provider))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Box::new(PollingMonitor::new(provider))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    // Thread-safe interior mutability for mock state
    #[derive(Clone)]
    struct MockState {
        content: Option<ClipboardContent>,
        app_name: Option<String>,
        _change_count: i64,
        read_calls: usize,
    }

    struct MockClipboardProvider {
        state: Arc<Mutex<MockState>>,
    }

    impl MockClipboardProvider {
        fn new() -> Self {
            Self {
                state: Arc::new(Mutex::new(MockState {
                    content: None,
                    app_name: None,
                    _change_count: 0,
                    read_calls: 0,
                })),
            }
        }

        fn set_content(&self, content: Option<ClipboardContent>) {
            let mut state = self.state.lock().unwrap();
            state.content = content;
        }

        #[allow(dead_code)]
        fn get_read_calls(&self) -> usize {
            self.state.lock().unwrap().read_calls
        }
    }

    impl ClipboardProvider for MockClipboardProvider {
        fn read_clipboard(&self) -> Result<Option<ClipboardContent>> {
            let mut state = self.state.lock().unwrap();
            state.read_calls += 1;
            // Clone content to return
            Ok(state.content.clone())
        }

        fn get_active_app_name(&self) -> Option<String> {
            self.state.lock().unwrap().app_name.clone()
        }

        fn get_change_count(&self) -> Result<i64> {
            Ok(self.state.lock().unwrap()._change_count)
        }

        fn platform_name(&self) -> &'static str {
            "Mock"
        }
    }

    #[test]
    fn test_html_and_text_same_plain_dedup() {
        // Html with the same plain text as a subsequent Text entry should dedup
        let mock = MockClipboardProvider::new();
        mock.set_content(Some(ClipboardContent::Html {
            html: "<b>Hello</b>".to_string(),
            plain: "Hello".to_string(),
        }));
        let state_ref = mock.state.clone();
        let mut monitor = PollingMonitor::new(Box::new(mock));

        // First check: new Html content
        let result = monitor.check().unwrap();
        assert!(matches!(result, ClipboardCheckResult::Changed { .. }));

        // Now swap to plain Text with same content
        {
            let mut state = state_ref.lock().unwrap();
            state.content = Some(ClipboardContent::Text {
                content: "Hello".to_string(),
            });
        }

        // Second check: same plain text → should be Unchanged
        let result = monitor.check().unwrap();
        assert!(
            matches!(result, ClipboardCheckResult::Unchanged),
            "Same plain text via different format should be treated as unchanged"
        );
    }

    #[test]
    fn test_notify_wrote_suppresses_next_tick() {
        let mock = MockClipboardProvider::new();
        mock.set_content(Some(ClipboardContent::Text {
            content: "Hello".to_string(),
        }));
        let mut monitor = PollingMonitor::new(Box::new(mock));

        // Simulate ClipsX writing "Hello" to the clipboard
        monitor.notify_wrote("Hello");

        // Next check should be suppressed
        let result = monitor.check().unwrap();
        assert!(
            matches!(result, ClipboardCheckResult::Unchanged),
            "notify_wrote should suppress the next tick for the same content"
        );
    }

    #[test]
    fn test_rtf_and_text_same_plain_dedup() {
        let mock = MockClipboardProvider::new();
        mock.set_content(Some(ClipboardContent::Rtf {
            rtf: r"{\rtf1 Hello}".to_string(),
            plain: "Hello".to_string(),
        }));
        let state_ref = mock.state.clone();
        let mut monitor = PollingMonitor::new(Box::new(mock));

        let result = monitor.check().unwrap();
        assert!(matches!(result, ClipboardCheckResult::Changed { .. }));

        // Switch to plain Text
        {
            let mut state = state_ref.lock().unwrap();
            state.content = Some(ClipboardContent::Text {
                content: "Hello".to_string(),
            });
        }

        let result = monitor.check().unwrap();
        assert!(
            matches!(result, ClipboardCheckResult::Unchanged),
            "Same plain text via RTF→Text should be treated as unchanged"
        );
    }

    #[test]
    fn test_polling_monitor_unchanged_initially() {
        let provider = Box::new(MockClipboardProvider::new());
        let mut monitor = PollingMonitor::new(provider);

        // First check with empty clipboard
        let result = monitor.check().unwrap();
        assert!(matches!(result, ClipboardCheckResult::Unchanged));
    }

    #[test]
    fn test_polling_monitor_detects_change() {
        // Setup mock with initial content
        let mock = MockClipboardProvider::new();
        mock.set_content(Some(ClipboardContent::Text {
            content: "hello".to_string(),
        }));

        // We need to clone the state or ref to keep access for assertion,
        // but provider takes ownership.
        // Pattern: Keep a reference to the shared state "backend"
        let state_ref = mock.state.clone();

        let mut monitor = PollingMonitor::new(Box::new(mock));

        // First check: should be "changed" because it's new
        let result = monitor.check().unwrap();
        match result {
            ClipboardCheckResult::Changed { content, .. } => {
                if let ClipboardContent::Text { content } = content {
                    assert_eq!(content, "hello");
                } else {
                    panic!("Wrong content type");
                }
            }
            _ => panic!("Expected Changed"),
        }

        // Second check with same content: should be "unchanged" (hash match)
        let result = monitor.check().unwrap();
        assert!(matches!(result, ClipboardCheckResult::Unchanged));

        // Third check with new content
        {
            let mut state = state_ref.lock().unwrap();
            state.content = Some(ClipboardContent::Text {
                content: "world".to_string(),
            });
        }

        let result = monitor.check().unwrap();
        match result {
            ClipboardCheckResult::Changed { content, .. } => {
                if let ClipboardContent::Text { content } = content {
                    assert_eq!(content, "world");
                } else {
                    panic!("Wrong content type");
                }
            }
            _ => panic!("Expected Changed"),
        }
    }
}
