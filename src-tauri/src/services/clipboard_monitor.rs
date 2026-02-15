use super::clipboard_platform::{self, ClipboardContent};
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
}

/// macOS monitor using NSPasteboard.changeCount (fast path)
///
/// JS/TS equivalent: class MacOSMonitor {
///   private lastChangeCount: number = 0
/// }
pub struct MacOSMonitor {
    last_change_count: i64,
}

impl MacOSMonitor {
    pub fn new() -> Self {
        // NOTE: `Self` is shorthand for `MacOSMonitor`
        // JS equivalent: constructor() { this.lastChangeCount = 0 }
        Self {
            last_change_count: 0,
        }
    }
}

// NOTE: `impl Trait for Type` is how we implement interfaces in Rust
// JS equivalent: class MacOSMonitor implements ClipboardMonitor { ... }
impl ClipboardMonitor for MacOSMonitor {
    fn check(&mut self) -> Result<ClipboardCheckResult> {
        // Fast path: check changeCount first (1 syscall, ~1μs)
        // NOTE: `?` is error propagation - if error, return early
        // JS equivalent: const current = await getChangeCount() (but with try/catch)
        let current = clipboard_platform::get_change_count()?;

        if current > 0 && current == self.last_change_count {
            // NOTE: Early return with Ok() wraps the value in Result
            // JS equivalent: return { type: 'unchanged' }
            return Ok(ClipboardCheckResult::Unchanged);
        }

        let content = match clipboard_platform::read_clipboard()? {
            Some(c) => c,
            None => return Ok(ClipboardCheckResult::Unchanged),
        };

        let hash = compute_content_hash(&content);
        // NOTE: Direct assignment, no `this.` needed
        self.last_change_count = current;

        // NOTE: Return enum variant with named fields
        // JS equivalent: return { type: 'changed', content, hash }
        Ok(ClipboardCheckResult::Changed { content, hash })
    }

    fn platform_name(&self) -> &'static str {
        "macOS"
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
}

impl PollingMonitor {
    pub fn new() -> Self {
        // NOTE: Start with None (no hash stored yet)
        Self { last_hash: None }
    }
}

impl ClipboardMonitor for PollingMonitor {
    fn check(&mut self) -> Result<ClipboardCheckResult> {
        // No fast path: must read clipboard every time (Windows/Linux limitation)
        let content = match clipboard_platform::read_clipboard()? {
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

        Ok(ClipboardCheckResult::Changed { content, hash })
    }

    fn platform_name(&self) -> &'static str {
        #[cfg(target_os = "windows")]
        return "Windows";

        #[cfg(target_os = "linux")]
        return "Linux";

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        return "Unknown";
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
        // `..` means "ignore other fields" (like `plain` in Html/Rtf)
        ClipboardContent::Text { content } => {
            let mut hasher = DefaultHasher::new();
            content.hash(&mut hasher);
            // NOTE: `{:x}` formats as hexadecimal
            // JS equivalent: hasher.finish().toString(16)
            format!("{:x}", hasher.finish())
        }
        ClipboardContent::Html { html, .. } => {
            let mut hasher = DefaultHasher::new();
            html.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        }
        ClipboardContent::Rtf { rtf, .. } => {
            let mut hasher = DefaultHasher::new();
            rtf.hash(&mut hasher);
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
    use image::GenericImageView;
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
pub fn create_monitor() -> Box<dyn ClipboardMonitor> {
    // NOTE: `#[cfg(...)]` is compile-time conditional compilation
    // JS equivalent: if (process.platform === 'darwin') { ... }
    // But this happens at compile time, not runtime
    #[cfg(target_os = "macos")]
    {
        Box::new(MacOSMonitor::new())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Box::new(PollingMonitor::new())
    }
}
