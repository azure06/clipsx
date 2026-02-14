/// Platform-specific clipboard utilities
/// 
/// **macOS (NSPasteboard):**
/// - Full support for all clipboard formats (text, HTML, RTF, images, files)
/// - Uses NSPasteboard.changeCount for efficient duplicate detection
/// - changeCount increments only on actual clipboard changes
/// - Prevents reading image data with varying TIFF metadata
/// 
/// **Windows/Linux (arboard fallback):**
/// - Basic support (text and images only)
/// - No change count API → reads clipboard every 500ms
/// - May have duplicate detection issues with images
/// - TODO: Implement Windows GetClipboardSequenceNumber() for better performance
/// 
/// This module provides access to clipboard data types:
/// - Plain text
/// - HTML (macOS only)
/// - RTF (macOS only)
/// - Images (PNG, JPEG, TIFF)
/// - File paths (macOS only)
/// 
/// macOS stores clipboard data in multiple formats simultaneously.
/// We check all formats and prioritize based on richness.

use anyhow::{Result, anyhow};
use std::path::PathBuf;

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSPasteboard, NSPasteboardTypeHTML, NSPasteboardTypeRTF, NSPasteboardTypeTIFF, NSPasteboardTypePNG, NSPasteboardTypeString},
    base::{id, nil},
    foundation::NSString,
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[derive(Debug, Clone)]
pub enum ClipboardContent {
    Text { content: String },
    Html { html: String, plain: String },
    Rtf { rtf: String, plain: String },
    Image { data: Vec<u8>, format: ImageFormat },
    Files { paths: Vec<String> },
}

#[derive(Debug, Clone, Copy)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Tiff,
}

impl ImageFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Tiff => "tiff",
        }
    }
    
    pub fn mime_type(&self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Tiff => "image/tiff",
        }
    }
}

#[cfg(target_os = "macos")]
pub fn get_change_count() -> Result<i64> {
    unsafe {
        let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];
        let count: i64 = msg_send![pasteboard, changeCount];
        Ok(count)
    }
}

#[cfg(target_os = "macos")]
pub fn read_clipboard() -> Result<Option<ClipboardContent>> {
    unsafe {
        let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];
        
        // Check for files first (highest priority for drag-drop)
        if let Some(files) = read_files(pasteboard) {
            return Ok(Some(ClipboardContent::Files { paths: files }));
        }
        
        // Check for images
        if let Some((data, format)) = read_image(pasteboard) {
            return Ok(Some(ClipboardContent::Image { data, format }));
        }
        
        // Check for HTML (with fallback to plain text)
        if let Some((html, plain)) = read_html(pasteboard) {
            return Ok(Some(ClipboardContent::Html { html, plain }));
        }
        
        // Check for RTF (with fallback to plain text)
        if let Some((rtf, plain)) = read_rtf(pasteboard) {
            return Ok(Some(ClipboardContent::Rtf { rtf, plain }));
        }
        
        // Fallback to plain text
        if let Some(text) = read_text(pasteboard) {
            return Ok(Some(ClipboardContent::Text { content: text }));
        }
        
        Ok(None)
    }
}

#[cfg(target_os = "macos")]
unsafe fn read_text(pasteboard: id) -> Option<String> {
    let ns_string: id = msg_send![pasteboard, stringForType: NSPasteboardTypeString];
    if ns_string == nil {
        return None;
    }
    
    let c_str: *const i8 = msg_send![ns_string, UTF8String];
    if c_str.is_null() {
        return None;
    }
    
    let text = std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned();
    Some(text)
}

#[cfg(target_os = "macos")]
unsafe fn read_html(pasteboard: id) -> Option<(String, String)> {
    let ns_html: id = msg_send![pasteboard, stringForType: NSPasteboardTypeHTML];
    if ns_html == nil {
        return None;
    }
    
    let c_str: *const i8 = msg_send![ns_html, UTF8String];
    if c_str.is_null() {
        return None;
    }
    
    let html = std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned();
    let plain = read_text(pasteboard).unwrap_or_else(|| strip_html(&html));
    
    Some((html, plain))
}

#[cfg(target_os = "macos")]
unsafe fn read_rtf(pasteboard: id) -> Option<(String, String)> {
    let ns_rtf_data: id = msg_send![pasteboard, dataForType: NSPasteboardTypeRTF];
    if ns_rtf_data == nil {
        return None;
    }
    
    let length: usize = msg_send![ns_rtf_data, length];
    let bytes: *const u8 = msg_send![ns_rtf_data, bytes];
    
    if bytes.is_null() || length == 0 {
        return None;
    }
    
    let data = std::slice::from_raw_parts(bytes, length);
    let rtf = String::from_utf8_lossy(data).into_owned();
    let plain = read_text(pasteboard).unwrap_or_else(|| extract_rtf_text(&rtf));
    
    Some((rtf, plain))
}

#[cfg(target_os = "macos")]
unsafe fn read_image(pasteboard: id) -> Option<(Vec<u8>, ImageFormat)> {
    use cocoa::foundation::NSString;
    use cocoa::base::nil;
    
    // Try PNG first (most compatible)
    let png_str = NSString::alloc(nil).init_str("public.png");
    if let Some(data) = read_image_data(pasteboard, png_str) {
        let _: () = msg_send![png_str, release];
        return Some((data, ImageFormat::Png));
    }
    let _: () = msg_send![png_str, release];
    
    // Try TIFF (common on macOS screenshots)
    let tiff_str = NSString::alloc(nil).init_str("public.tiff");
    if let Some(data) = read_image_data(pasteboard, tiff_str) {
        let _: () = msg_send![tiff_str, release];
        return Some((data, ImageFormat::Tiff));
    }
    let _: () = msg_send![tiff_str, release];
    
    None
}

#[cfg(target_os = "macos")]
unsafe fn read_image_data(pasteboard: id, ns_type: id) -> Option<Vec<u8>> {
    let ns_data: id = msg_send![pasteboard, dataForType: ns_type];
    
    if ns_data == nil {
        return None;
    }
    
    let length: usize = msg_send![ns_data, length];
    let bytes: *const u8 = msg_send![ns_data, bytes];
    
    if bytes.is_null() || length == 0 {
        return None;
    }
    
    let data = std::slice::from_raw_parts(bytes, length).to_vec();
    Some(data)
}

#[cfg(target_os = "macos")]
unsafe fn read_files(pasteboard: id) -> Option<Vec<String>> {
    use cocoa::foundation::NSString;
    use cocoa::base::nil;
    
    // Try reading file URLs using NSFilenamesPboardType (legacy approach)
    let filenames_type = NSString::alloc(nil).init_str("NSFilenamesPboardType");
    let property_list: id = msg_send![pasteboard, propertyListForType: filenames_type];
    let _: () = msg_send![filenames_type, release];
    
    if property_list == nil {
        return None;
    }
    
    // property_list should be an NSArray of NSString paths
    let count: usize = msg_send![property_list, count];
    if count == 0 {
        return None;
    }
    
    let mut paths = Vec::new();
    for i in 0..count {
        let path_ns: id = msg_send![property_list, objectAtIndex: i];
        
        if path_ns != nil {
            let c_str: *const i8 = msg_send![path_ns, UTF8String];
            if !c_str.is_null() {
                let path = std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned();
                paths.push(path);
            }
        }
    }
    
    if paths.is_empty() {
        None
    } else {
        Some(paths)
    }
}

/// Fallback: strip HTML tags to get plain text
fn strip_html(html: &str) -> String {
    // Simple HTML stripping - in production, use a proper HTML parser
    html.replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<p>", "\n")
        .replace("</p>", "\n")
        .chars()
        .fold((String::new(), false), |(mut text, mut in_tag), c| {
            match c {
                '<' => {
                    in_tag = true;
                    (text, in_tag)
                }
                '>' => {
                    in_tag = false;
                    (text, in_tag)
                }
                _ if !in_tag => {
                    text.push(c);
                    (text, in_tag)
                }
                _ => (text, in_tag),
            }
        })
        .0
        .trim()
        .to_string()
}

/// Fallback: extract plain text from RTF
fn extract_rtf_text(rtf: &str) -> String {
    // Very basic RTF text extraction
    // In production, use a proper RTF parser
    rtf.lines()
        .filter(|line| !line.starts_with("\\"))
        .filter(|line| !line.starts_with("{"))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

// ===== NON-MACOS PLATFORMS (Windows, Linux, etc.) =====
// 
// Windows/Linux don't have a reliable clipboard change detection API like macOS's changeCount.
// 
// Windows GetClipboardSequenceNumber() exists but:
//   - Requires unsafe Win32 API calls
//   - Still has issues with image metadata variations
// 
// For now, we return -1 which forces fallback to content hash comparison.
// This works but may have duplicate detection issues with images.
// 
// TODO: Consider implementing Windows-specific clipboard monitoring:
//   - Use GetClipboardSequenceNumber() for better change detection
//   - Or use clipboard format listeners to detect actual changes

#[cfg(not(target_os = "macos"))]
pub fn get_change_count() -> Result<i64> {
    // Return -1 to signal "no change tracking available"
    // Caller will skip the fast path and read clipboard content every time
    Ok(-1)
}

#[cfg(not(target_os = "macos"))]
pub fn read_clipboard() -> Result<Option<ClipboardContent>> {
    // For non-macOS platforms, use arboard (cross-platform)
    use arboard::Clipboard;
    
    let mut clipboard = Clipboard::new()?;
    
    // Try to get image first
    // NOTE: arboard returns ImageData with raw RGBA pixels, not encoded PNG
    if let Ok(img) = clipboard.get_image() {
        // Convert RGBA pixels to PNG format
        use image::{ImageBuffer, RgbaImage};
        
        // Create image buffer from raw RGBA data
        let rgba_image: RgbaImage = ImageBuffer::from_raw(
            img.width as u32,
            img.height as u32,
            img.bytes.to_vec()
        ).ok_or_else(|| anyhow!("Failed to create image from clipboard data"))?;
        
        // Encode to PNG
        let mut png_data = Vec::new();
        rgba_image.write_to(
            &mut std::io::Cursor::new(&mut png_data),
            image::ImageFormat::Png
        )?;
        
        return Ok(Some(ClipboardContent::Image {
            data: png_data,
            format: ImageFormat::Png,
        }));
    }
    
    // Fallback to text
    if let Ok(text) = clipboard.get_text() {
        return Ok(Some(ClipboardContent::Text { content: text }));
    }
    
    Ok(None)
}
