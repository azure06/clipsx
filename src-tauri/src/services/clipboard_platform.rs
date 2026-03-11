#![allow(dead_code, deprecated, unused_imports, unexpected_cfgs)]
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
use anyhow::{anyhow, Result};

#[cfg(target_os = "macos")]
use cocoa::{
    appkit::{NSPasteboardTypeHTML, NSPasteboardTypeRTF, NSPasteboardTypeString},
    base::{id, nil},
};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HANDLE, HGLOBAL, MAX_PATH},
    System::{
        DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
        Memory::{GlobalLock, GlobalUnlock},
        ProcessStatus::GetModuleFileNameExW,
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    },
    UI::{
        Shell::{DragQueryFileW, HDROP},
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    },
};

#[derive(Debug, Clone)]
pub enum ClipboardContent {
    Text {
        content: String,
    },
    Html {
        html: String,
        plain: String,
    },
    Rtf {
        rtf: String,
        plain: String,
    },
    Image {
        data: Vec<u8>,
        format: ImageFormat,
        /// PDF representation captured alongside the raster image (e.g. from a
        /// PowerPoint slideshow slide).  None for plain screenshots / photos.
        pdf_data: Option<Vec<u8>>,
    },
    Files {
        paths: Vec<String>,
    },
    Office {
        ole_data: Option<Vec<u8>>, // OLE/Office package → clipboard_data/office/{id}.bin
        ole_type: Option<String>, // Exact UTI captured at read time (e.g. "com.microsoft.PowerPoint-16.0-Slides-Package").
                                  // None = UTI was not recorded; OLE data MUST NOT be written without a known UTI.
        /// All other com.microsoft.* binary types (e.g. ole.source.*) captured alongside the package.
        /// These small reference types tell Office apps their native format is on the pasteboard.
        /// Without them, PowerPoint falls back to PNG on paste.
        extra_types: Vec<(String, Vec<u8>)>,
        svg_data: Option<Vec<u8>>, // SVG vector graphics → clipboard_data/svg/{id}.svg
        pdf_data: Option<Vec<u8>>, // PDF document → clipboard_data/pdf/{id}.pdf
        png_data: Option<Vec<u8>>, // PNG raster image → clipboard_data/images/{id}.png
        html_data: Option<String>, // HTML formatted payload for styled rendering (e.g. Excel tables)
        rtf_data: Option<String>,  // RTF formatted payload
        extracted_text: String,    // Text from pasteboard/SVG/PDF → content_text (FTS5 indexed)
        source_app: String,        // "Microsoft Word", "Microsoft Excel", etc.
    },
}

#[allow(dead_code)]
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
pub fn read_clipboard(_app: &tauri::AppHandle) -> Result<Option<ClipboardContent>> {
    unsafe {
        let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];

        eprintln!("[DEBUG] read_clipboard() called");

        // Check for files first (highest priority for drag-drop)
        if let Some(files) = read_files(pasteboard) {
            eprintln!("[DEBUG] Detected as Files content");
            return Ok(Some(ClipboardContent::Files { paths: files }));
        }

        // Check for Office content (BEFORE generic images)
        // Office apps provide PNG, but we want Office-specific handling
        eprintln!("[DEBUG] Checking for Office content...");
        if let Some(office_content) = read_office_content(pasteboard) {
            eprintln!("[DEBUG] Detected as Office content");
            return Ok(Some(office_content));
        }
        eprintln!("[DEBUG] Not Office content, continuing with other checks");

        // Check for images
        if let Some((data, format, pdf_data)) = read_image(pasteboard) {
            return Ok(Some(ClipboardContent::Image { data, format, pdf_data }));
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

/// Write clipboard content (all formats) back to the system clipboard
/// This restores the original multi-format clipboard data
#[cfg(target_os = "macos")]
pub fn write_clipboard(content: &ClipboardContent) -> Result<()> {
    use cocoa::base::nil;
    use std::ffi::CString;

    unsafe {
        let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];

        // Clear existing clipboard data
        let _: () = msg_send![pasteboard, clearContents];

        match content {
            ClipboardContent::Text { content } => {
                // Write plain text
                let ns_string = NSString::from_str(content);
                let _: bool =
                    msg_send![pasteboard, setString:ns_string forType:NSPasteboardTypeString];
            }

            ClipboardContent::Html { html, plain } => {
                // Write HTML + plain text fallback
                let html_ns = NSString::from_str(html);
                let plain_ns = NSString::from_str(plain);
                let _: bool = msg_send![pasteboard, setString:html_ns forType:NSPasteboardTypeHTML];
                let _: bool =
                    msg_send![pasteboard, setString:plain_ns forType:NSPasteboardTypeString];
            }

            ClipboardContent::Rtf { rtf, plain } => {
                // Write RTF + plain text fallback
                let rtf_data = NSData::from_vec(rtf.as_bytes().to_vec());
                let plain_ns = NSString::from_str(plain);
                let _: bool = msg_send![pasteboard, setData:rtf_data forType:NSPasteboardTypeRTF];
                let _: bool =
                    msg_send![pasteboard, setString:plain_ns forType:NSPasteboardTypeString];
            }

            ClipboardContent::Image { data, format, pdf_data } => {
                // Write image in its original format
                let image_data = NSData::from_vec(data.clone());
                let type_str = match format {
                    ImageFormat::Png => "public.png",
                    ImageFormat::Jpeg => "public.jpeg",
                    ImageFormat::Tiff => "public.tiff",
                };

                if let Ok(type_c_str) = CString::new(type_str) {
                    let ns_type: id =
                        msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                    if ns_type != nil {
                        let _: bool = msg_send![pasteboard, setData:image_data forType:ns_type];
                    }
                }

                // Write PDF if captured (e.g. PowerPoint slideshow preserves vector quality)
                if let Some(pdf) = pdf_data {
                    if let Ok(type_c_str) = CString::new("com.adobe.pdf") {
                        let ns_type: id =
                            msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                        if ns_type != nil {
                            let pdf_ns_data = NSData::from_vec(pdf.clone());
                            let _: bool = msg_send![pasteboard, setData:pdf_ns_data forType:ns_type];
                        }
                    }
                }
            }

            ClipboardContent::Files { paths } => {
                // Write file paths (not implemented yet - complex on macOS)
                eprintln!("[WARN] Writing file paths to clipboard not yet implemented");
                // For now, just write the paths as text
                let paths_text = paths.join("\n");
                let ns_string = NSString::from_str(&paths_text);
                let _: bool =
                    msg_send![pasteboard, setString:ns_string forType:NSPasteboardTypeString];
            }

            ClipboardContent::Office {
                ole_data,
                ole_type,
                extra_types,
                svg_data,
                pdf_data,
                png_data,
                html_data,
                rtf_data,
                extracted_text,
                ..
            } => {
                eprintln!("[DEBUG] Writing Office content to clipboard:");

                // Write OLE package FIRST so it becomes types[0] — the "primary" representation.
                // NSPasteboard.types returns types in insertion order; PowerPoint's paste handler
                // (and the modern readObjectsForClasses: API) treats the first type as the primary
                // format. Writing the native package first matches how PowerPoint itself declares
                // clipboard content and ensures PowerPoint pastes as an editable slide, not an image.
                // Write OLE only when we have both the data AND its captured UTI.
                // If ole_type is None (e.g. clip captured before UTI tracking was added),
                // skip writing — guessing a version-specific UTI would corrupt the pasteboard
                // and block the SVG/PDF/PNG fallback paths below.
                if let (Some(ole), Some(uti)) = (ole_data, ole_type.as_deref()) {
                    if let Ok(type_c_str) = CString::new(uti) {
                        let ns_type: id =
                            msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                        if ns_type != nil {
                            let ole_ns_data = NSData::from_vec(ole.clone());
                            let _: bool =
                                msg_send![pasteboard, setData:ole_ns_data forType:ns_type];
                            eprintln!(
                                "[DEBUG]   ✓ OLE written ({} bytes, type={})",
                                ole.len(),
                                uti
                            );
                        }
                    }
                }

                // Write extra types after the package.
                // Includes small reference blobs (DataObject, Internal-Slides, appbundleid)
                // AND the ole.source.* presence signals (0 bytes). The signals are written
                // as empty NSData — their presence in [pasteboard types] is what matters,
                // not their content. Must come after the package so the package remains
                // types[0] (the primary representation PowerPoint reads).
                for (t, d) in extra_types {
                    if let Ok(type_c_str) = CString::new(t.as_str()) {
                        let ns_type: id =
                            msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                        if ns_type != nil {
                            let ns_data = NSData::from_vec(d.clone());
                            let ok: bool = msg_send![pasteboard, setData:ns_data forType:ns_type];
                            eprintln!("[DEBUG]   {} extra type '{}' ({} bytes)", if ok { "✓" } else { "✗" }, t, d.len());
                        }
                    }
                }

                // Write SVG
                if let Some(svg) = svg_data {
                    if let Ok(type_c_str) = CString::new("com.microsoft.image-svg-xml") {
                        let ns_type: id =
                            msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                        if ns_type != nil {
                            let svg_ns_data = NSData::from_vec(svg.clone());
                            let _: bool =
                                msg_send![pasteboard, setData:svg_ns_data forType:ns_type];
                            eprintln!("[DEBUG]   ✓ SVG written ({} bytes)", svg.len());
                        }
                    }
                }

                // Write PDF
                if let Some(pdf) = pdf_data {
                    if let Ok(type_c_str) = CString::new("com.adobe.pdf") {
                        let ns_type: id =
                            msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                        if ns_type != nil {
                            let pdf_ns_data = NSData::from_vec(pdf.clone());
                            let _: bool =
                                msg_send![pasteboard, setData:pdf_ns_data forType:ns_type];
                            eprintln!("[DEBUG]   ✓ PDF written ({} bytes)", pdf.len());
                        }
                    }
                }

                // Write PNG (raster fallback — written last so OLE/SVG take precedence)
                if let Some(png) = png_data {
                    if let Ok(type_c_str) = CString::new("public.png") {
                        let ns_type: id =
                            msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
                        if ns_type != nil {
                            let png_ns_data = NSData::from_vec(png.clone());
                            let _: bool =
                                msg_send![pasteboard, setData:png_ns_data forType:ns_type];
                            eprintln!("[DEBUG]   ✓ PNG written ({} bytes)", png.len());
                        }
                    }
                }

                // Write HTML if captured (enables styled paste in apps like Pages, Keynote)
                if let Some(html) = html_data {
                    let html_ns = NSString::from_str(html);
                    let _: bool =
                        msg_send![pasteboard, setString:html_ns forType:NSPasteboardTypeHTML];
                    eprintln!("[DEBUG]   ✓ HTML written ({} chars)", html.len());
                }

                // Write RTF if captured
                if let Some(rtf) = rtf_data {
                    let rtf_bytes = NSData::from_vec(rtf.as_bytes().to_vec());
                    let _: bool =
                        msg_send![pasteboard, setData:rtf_bytes forType:NSPasteboardTypeRTF];
                    eprintln!("[DEBUG]   ✓ RTF written ({} chars)", rtf.len());
                }

                // Write plain text fallback
                if !extracted_text.is_empty() {
                    let ns_string = NSString::from_str(extracted_text);
                    let _: bool =
                        msg_send![pasteboard, setString:ns_string forType:NSPasteboardTypeString];
                    eprintln!("[DEBUG]   ✓ Text written ({} chars)", extracted_text.len());
                }

                eprintln!("[DEBUG] Office content write complete");
            }
        }

        Ok(())
    }
}

// Helper: Create NSString from Rust string
#[cfg(target_os = "macos")]
struct NSString;

#[cfg(target_os = "macos")]
impl NSString {
    unsafe fn from_str(s: &str) -> id {
        // Use initWithBytes:length:encoding: (NSUTF8StringEncoding = 4)
        // This accepts an explicit byte count so embedded null bytes never panic.
        let bytes_ptr = s.as_ptr() as *const std::ffi::c_void;
        let ns_string: id = msg_send![class!(NSString), alloc];
        msg_send![ns_string, initWithBytes:bytes_ptr length:s.len() encoding:4usize]
    }
}

// Helper: Create NSData from Vec<u8>
#[cfg(target_os = "macos")]
struct NSData;

#[cfg(target_os = "macos")]
impl NSData {
    unsafe fn from_vec(data: Vec<u8>) -> id {
        let bytes_ptr = data.as_ptr() as *const std::ffi::c_void;
        let length = data.len();
        msg_send![class!(NSData), dataWithBytes:bytes_ptr length:length]
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

    let text = std::ffi::CStr::from_ptr(c_str)
        .to_string_lossy()
        .into_owned();
    Some(text)
}

/// Strip HTML tags to extract plain text (basic implementation)
fn strip_html(html: &str) -> String {
    html.replace("<br>", "\n")
        .replace("<BR>", "\n")
        .replace("</p>", "\n")
        .replace("</P>", "\n")
        .chars()
        .fold((String::new(), false), |(mut acc, mut in_tag), c| match c {
            '<' => {
                in_tag = true;
                (acc, in_tag)
            }
            '>' => {
                in_tag = false;
                (acc, in_tag)
            }
            _ if !in_tag => {
                acc.push(c);
                (acc, in_tag)
            }
            _ => (acc, in_tag),
        })
        .0
        .trim()
        .to_string()
}

/// Extract plain text from RTF (basic implementation)
fn extract_rtf_text(rtf: &str) -> String {
    // Very basic RTF text extraction
    // RTF format: {\rtf1...text...}
    // Remove control words and braces
    let mut result = String::new();
    let mut in_control_word = false;
    let mut depth = 0;

    for c in rtf.chars() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            '\\' => in_control_word = true,
            ' ' | '\n' | '\r' if in_control_word => in_control_word = false,
            _ if !in_control_word && depth > 0 => result.push(c),
            _ => {}
        }
    }

    result.trim().to_string()
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

    let html = std::ffi::CStr::from_ptr(c_str)
        .to_string_lossy()
        .into_owned();
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
unsafe fn read_image(pasteboard: id) -> Option<(Vec<u8>, ImageFormat, Option<Vec<u8>>)> {
    use cocoa::base::nil;
    use std::ffi::CString;

    // Helper: read PDF data alongside the raster image (e.g. PowerPoint slideshow)
    let read_pdf = || -> Option<Vec<u8>> {
        if let Ok(c) = CString::new("com.adobe.pdf") {
            let ns_type: id = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
            if ns_type != nil {
                if let Some(d) = read_image_data(pasteboard, ns_type) {
                    return Some(d);
                }
            }
        }
        if let Ok(c) = CString::new("Apple PDF pasteboard type") {
            let ns_type: id = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
            if ns_type != nil {
                if let Some(d) = read_image_data(pasteboard, ns_type) {
                    return Some(d);
                }
            }
        }
        None
    };

    // Try PNG first (most compatible)
    if let Ok(png_c_str) = CString::new("public.png") {
        let png_ns: id = msg_send![class!(NSString), stringWithUTF8String: png_c_str.as_ptr()];
        if png_ns != nil {
            if let Some(data) = read_image_data(pasteboard, png_ns) {
                return Some((data, ImageFormat::Png, read_pdf()));
            }
        }
    }

    // Try TIFF (common on macOS screenshots)
    if let Ok(tiff_c_str) = CString::new("public.tiff") {
        let tiff_ns: id = msg_send![class!(NSString), stringWithUTF8String: tiff_c_str.as_ptr()];
        if tiff_ns != nil {
            if let Some(data) = read_image_data(pasteboard, tiff_ns) {
                return Some((data, ImageFormat::Tiff, read_pdf()));
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
unsafe fn read_image_data(pasteboard: id, ns_type: id) -> Option<Vec<u8>> {
    // Get type name for debugging
    let c_str: *const i8 = msg_send![ns_type, UTF8String];
    let type_name = if !c_str.is_null() {
        std::ffi::CStr::from_ptr(c_str)
            .to_string_lossy()
            .to_string()
    } else {
        "unknown".to_string()
    };

    eprintln!("[DEBUG] read_image_data() called for type: {}", type_name);

    let ns_data: id = msg_send![pasteboard, dataForType: ns_type];

    if ns_data == nil {
        eprintln!("[DEBUG]   dataForType returned nil for {}", type_name);
        return None;
    }

    let length: usize = msg_send![ns_data, length];
    let bytes: *const u8 = msg_send![ns_data, bytes];

    eprintln!(
        "[DEBUG]   dataForType returned data - length: {}, bytes ptr null: {}",
        length,
        bytes.is_null()
    );

    if bytes.is_null() || length == 0 {
        eprintln!("[DEBUG]   Rejecting data (null pointer or zero length)");
        return None;
    }

    let data = std::slice::from_raw_parts(bytes, length).to_vec();
    eprintln!("[DEBUG]   Successfully extracted {} bytes", data.len());
    Some(data)
}

#[cfg(target_os = "macos")]
unsafe fn read_files(pasteboard: id) -> Option<Vec<String>> {
    use cocoa::base::nil;
    use std::ffi::CString;

    // Try reading file URLs using NSFilenamesPboardType (legacy approach)
    let filenames_c_str = CString::new("NSFilenamesPboardType").ok()?;
    let filenames_type: id =
        msg_send![class!(NSString), stringWithUTF8String: filenames_c_str.as_ptr()];

    if filenames_type == nil {
        return None;
    }

    let property_list: id = msg_send![pasteboard, propertyListForType: filenames_type];

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
                let path = std::ffi::CStr::from_ptr(c_str)
                    .to_string_lossy()
                    .into_owned();
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

/// Extract text content from SVG XML by parsing <text> elements
fn extract_svg_text(svg: &str) -> String {
    // Simple regex-based extraction of <text> elements
    // For production, consider using quick-xml crate for robust parsing
    let mut extracted = String::new();

    // Match <text>...</text> tags and extract content
    if let Ok(re) = regex::Regex::new(r"<text[^>]*>(.*?)</text>") {
        for cap in re.captures_iter(svg) {
            if let Some(text_match) = cap.get(1) {
                let text = text_match.as_str();
                // Basic HTML entity decoding
                let decoded = text
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&amp;", "&")
                    .replace("&quot;", "\"")
                    .replace("&#39;", "'");
                extracted.push_str(&decoded);
                extracted.push(' ');
            }
        }
    }

    extracted.trim().to_string()
}

/// Extract text content from PDF data
///
/// Uses pdf-extract crate to parse PDF and extract text layer
fn extract_pdf_text(pdf_data: &[u8]) -> String {
    // Try to extract text using pdf-extract
    match pdf_extract::extract_text_from_mem(pdf_data) {
        Ok(text) => {
            eprintln!(
                "[DEBUG] PDF text extraction successful: {} chars",
                text.len()
            );
            text
        }
        Err(e) => {
            eprintln!("[DEBUG] PDF text extraction failed: {}", e);
            String::new()
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn read_office_content(pasteboard: id) -> Option<ClipboardContent> {
    use cocoa::base::nil;
    use std::ffi::CString;

    // Check for Office-specific pasteboard types
    // Office apps provide OLE object, SVG, and PNG formats

    eprintln!("[DEBUG] read_office_content() called");

    // Helper: Check if pasteboard has a specific type
    let has_type = |type_str: &str| -> bool {
        if let Ok(type_c_str) = CString::new(type_str) {
            let ns_type: id =
                msg_send![class!(NSString), stringWithUTF8String: type_c_str.as_ptr()];
            if ns_type != nil {
                let types: id = msg_send![pasteboard, types];
                if types != nil {
                    let contains: bool = msg_send![types, containsObject: ns_type];
                    return contains;
                }
            }
        }
        false
    };

    // Get all pasteboard types as strings
    let types: id = msg_send![pasteboard, types];
    if types == nil {
        eprintln!("[DEBUG] No pasteboard types available (types == nil)");
        return None;
    }

    let count: usize = msg_send![types, count];
    eprintln!("[DEBUG] Found {} pasteboard types", count);

    // Log ALL available types for debugging
    eprintln!("[DEBUG] Available pasteboard types:");
    for i in 0..count {
        let ns_type: id = msg_send![types, objectAtIndex: i];
        if ns_type != nil {
            let c_str: *const i8 = msg_send![ns_type, UTF8String];
            if !c_str.is_null() {
                let type_str = std::ffi::CStr::from_ptr(c_str).to_string_lossy();
                eprintln!("[DEBUG]   [{}] {}", i, type_str);
            }
        }
    }

    let has_svg = has_type("com.microsoft.image-svg-xml");
    eprintln!(
        "[DEBUG] Has SVG type (com.microsoft.image-svg-xml): {}",
        has_svg
    );

    // ── Step 1: Scan all com.microsoft.* binary types ────────────────────────────────────────
    //
    // We enumerate every type whose name starts with "com.microsoft." and try to read its
    // binary data. Types with actual content (the OLE package, small reference blobs, etc.)
    // land in `candidates`. Types with 0 bytes (the ole.source.* signal flags) are handled
    // separately in Step 2 below because read_image_data() filters them out.
    //
    // WHY dynamic (not hardcoded version numbers):
    //   PowerPoint 14.x → "com.microsoft.PowerPoint-14.0-Slides-Package"
    //   PowerPoint 16.x → "com.microsoft.PowerPoint-16.0-Slides-Package"
    //   Hardcoding any version breaks capture on every other version.
    //
    // WHY pick the largest candidate as the OLE package:
    //   The actual slide package is large (50–500 KB).
    //   Other binary types (DataObject, Internal-Slides, appbundleid) are a few bytes each.
    //   Largest == the real content.
    //
    // WHY do this before the gate check:
    //   Some Office copies (e.g. future versions) may not include ole.source.* or SVG.
    //   Gating on their presence before this scan would miss those cases.
    eprintln!("[DEBUG] Scanning all com.microsoft.* types for OLE data...");
    let mut candidates: Vec<(String, Vec<u8>)> = Vec::new();
    let mut source_app = String::from("Microsoft Office");

    for i in 0..count {
        let ns_type_obj: id = msg_send![types, objectAtIndex: i];
        if ns_type_obj != nil {
            let c_str: *const i8 = msg_send![ns_type_obj, UTF8String];
            if !c_str.is_null() {
                let type_str = std::ffi::CStr::from_ptr(c_str).to_string_lossy();
                let t = type_str.as_ref();
                // Skip image/text subtypes — those are handled by the image/html/rtf paths
                if t.starts_with("com.microsoft.")
                    && !t.contains("image-svg")
                    && !t.contains("image-gif")
                    && !t.contains("image-jpeg")
                    && !t.contains("image-png")
                    && !t.contains("html-clipboard")
                    && !t.contains("string")
                    && !t.contains("text")
                {
                    eprintln!("[DEBUG]   Trying: {}", t);
                    if let Some(d) = read_image_data(pasteboard, ns_type_obj) {
                        eprintln!("[DEBUG]     -> Got {} bytes", d.len());
                        // Infer source app from the UTI name (case-insensitive) so we don't
                        // rely on a separate loop. Works for both package types
                        // ("PowerPoint-16.0-Slides-Package") and small blobs ("DataObject").
                        if source_app == "Microsoft Office" {
                            let t_lower = t.to_lowercase();
                            if t_lower.contains("powerpoint") {
                                source_app = String::from("Microsoft PowerPoint");
                            } else if t_lower.contains("word") {
                                source_app = String::from("Microsoft Word");
                            } else if t_lower.contains("excel") {
                                source_app = String::from("Microsoft Excel");
                            }
                        }
                        candidates.push((t.to_string(), d));
                    } else {
                        eprintln!("[DEBUG]     -> No data");
                    }
                }
            }
        }
    }

    // Gate: require at least one binary com.microsoft.* type OR an SVG to proceed.
    // If we have neither, this is not Office clipboard content.
    if candidates.is_empty() && !has_svg {
        eprintln!("[DEBUG] No com.microsoft.* data or SVG found - not Office content");
        return None;
    }

    eprintln!(
        "[DEBUG] Office content detected! candidates: {}, SVG: {}",
        candidates.len(),
        has_svg
    );

    // Split candidates: largest one is the OLE package, the rest are extra signal/reference types.
    let max_idx = candidates
        .iter()
        .enumerate()
        .max_by_key(|(_, (_, d))| d.len())
        .map(|(i, _)| i);

    let (ole_data, selected_ole_type, mut extra_types) = if let Some(idx) = max_idx {
        let (uti, data) = candidates.remove(idx);
        eprintln!("[DEBUG] Selected OLE: '{}' ({} bytes)", uti, data.len());
        for (t, d) in &candidates {
            eprintln!("[DEBUG] Extra type: '{}' ({} bytes)", t, d.len());
        }
        (Some(data), Some(uti), candidates)
    } else {
        eprintln!("[DEBUG] No com.microsoft.* binary data found on pasteboard");
        (None, None, vec![])
    };

    // ── Step 2: Capture ole.source.* presence signals ─────────────────────────────────────
    //
    // HOW POWERPOINT DECIDES WHAT TO PASTE:
    //   PowerPoint's paste handler does not scan for "Slides-Package" directly.
    //   It first checks for any type matching "com.microsoft.ole.source.*" as a signal
    //   that native OLE data is present. Only when that signal is found does it read
    //   the Slides-Package and paste as an editable slide. Without the signal it falls
    //   back to PNG regardless of whether the package is on the pasteboard.
    //
    // WHY these types have 0 bytes:
    //   "com.microsoft.ole.source.83172.0x6000027fa140" — the PID (83172) and memory
    //   address are the source app's lazy-rendering callback coordinates. The data is
    //   intentionally empty; the type NAME is the signal, not its content.
    //
    // WHY read_image_data() skips them:
    //   read_image_data() correctly rejects 0-byte data for all other types (avoids
    //   noise). We capture ole.source.* explicitly here so they end up in extra_types
    //   and are written back to the pasteboard on restore — with empty NSData, which
    //   is enough to declare the type and trigger PowerPoint's native paste path.
    for i in 0..count {
        let ns_type_obj: id = msg_send![types, objectAtIndex: i];
        if ns_type_obj != nil {
            let c_str: *const i8 = msg_send![ns_type_obj, UTF8String];
            if !c_str.is_null() {
                let type_str = std::ffi::CStr::from_ptr(c_str).to_string_lossy();
                let t = type_str.as_ref();
                // Add if not already present (it would be present only if somehow non-zero)
                if t.contains("ole.source") && !extra_types.iter().any(|(k, _)| k == t) {
                    eprintln!("[DEBUG] Capturing ole.source signal type (0 bytes): {}", t);
                    extra_types.push((t.to_string(), vec![]));
                }
            }
        }
    }

    // Extract SVG data (as bytes to save as file)
    let svg_data = if has_svg {
        eprintln!("[DEBUG] Attempting to extract SVG data");
        let data = CString::new("com.microsoft.image-svg-xml")
            .ok()
            .and_then(|c| {
                let ns_type: id = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
                if ns_type != nil {
                    read_image_data(pasteboard, ns_type)
                } else {
                    None
                }
            });
        if let Some(ref d) = data {
            eprintln!("[DEBUG] SVG data extracted: {} bytes", d.len());
        } else {
            eprintln!("[DEBUG] SVG data extraction failed (returned None)");
        }
        data
    } else {
        eprintln!("[DEBUG] No SVG type to extract");
        None
    };

    // Extract PDF data (Office often provides PDF, especially from thumbnails)
    eprintln!("[DEBUG] Attempting to extract PDF data");
    let pdf_data = {
        // Try "com.adobe.pdf" first (most common)
        let mut data = CString::new("com.adobe.pdf").ok().and_then(|c| {
            let ns_type: id = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
            if ns_type != nil {
                eprintln!("[DEBUG]   Trying com.adobe.pdf");
                read_image_data(pasteboard, ns_type)
            } else {
                None
            }
        });

        // Fallback to "Apple PDF pasteboard type" if needed
        if data.is_none() {
            data = CString::new("Apple PDF pasteboard type")
                .ok()
                .and_then(|c| {
                    let ns_type: id = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
                    if ns_type != nil {
                        eprintln!("[DEBUG]   Trying Apple PDF pasteboard type");
                        read_image_data(pasteboard, ns_type)
                    } else {
                        None
                    }
                });
        }

        if let Some(ref d) = data {
            eprintln!("[DEBUG] PDF data extracted: {} bytes", d.len());
        } else {
            eprintln!("[DEBUG] PDF data extraction failed (returned None)");
        }
        data
    };

    // Extract PNG data (Office always provides PNG fallback)
    eprintln!("[DEBUG] Attempting to extract PNG data");
    let png_data = CString::new("public.png").ok().and_then(|c| {
        let ns_type: id = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
        if ns_type != nil {
            read_image_data(pasteboard, ns_type)
        } else {
            None
        }
    });
    if let Some(ref d) = png_data {
        eprintln!("[DEBUG] PNG data extracted: {} bytes", d.len());
    } else {
        eprintln!("[DEBUG] PNG data extraction failed (returned None)");
    }

    // Extract text with priority: plain text -> SVG text -> PDF text
    let extracted_text = {
        // Priority 1: Plain text from pasteboard (fastest, most reliable)
        let plain_text = read_text(pasteboard).unwrap_or_default();
        if !plain_text.is_empty() {
            eprintln!(
                "[DEBUG] Using plain text from pasteboard: {} chars",
                plain_text.len()
            );
            plain_text
        } else if let Some(ref svg) = svg_data {
            // Priority 2: Extract text from SVG
            eprintln!("[DEBUG] Extracting text from SVG");
            let svg_str = String::from_utf8_lossy(svg);
            let text = extract_svg_text(&svg_str);
            eprintln!("[DEBUG] SVG text extracted: {} chars", text.len());
            if !text.is_empty() {
                text
            } else if let Some(ref pdf) = pdf_data {
                // Priority 3: Extract text from PDF (will implement extraction function)
                eprintln!("[DEBUG] Extracting text from PDF");
                let pdf_text = extract_pdf_text(pdf);
                eprintln!("[DEBUG] PDF text extracted: {} chars", pdf_text.len());
                pdf_text
            } else {
                String::new()
            }
        } else if let Some(ref pdf) = pdf_data {
            // No plain text or SVG, try PDF
            eprintln!("[DEBUG] Extracting text from PDF");
            let pdf_text = extract_pdf_text(pdf);
            eprintln!("[DEBUG] PDF text extracted: {} chars", pdf_text.len());
            pdf_text
        } else {
            eprintln!("[DEBUG] No text source available");
            String::new()
        }
    };

    eprintln!("[DEBUG] Returning Office content - OLE: {} (type: {:?}), SVG: {}, PDF: {}, PNG: {}, Text: {}",
              ole_data.is_some(), selected_ole_type, svg_data.is_some(), pdf_data.is_some(), png_data.is_some(), extracted_text.len());

    Some(ClipboardContent::Office {
        ole_data,
        ole_type: selected_ole_type,
        extra_types,
        svg_data,
        pdf_data,
        png_data,
        html_data: read_html(pasteboard).map(|(html, _)| html),
        rtf_data: read_rtf(pasteboard).map(|(rtf, _)| rtf),
        extracted_text,
        source_app,
    })
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
pub fn read_clipboard(_app: &tauri::AppHandle) -> Result<Option<ClipboardContent>> {
    #[cfg(target_os = "windows")]
    if let Some(mut office_content) = unsafe { read_office_content_windows() } {
        // Fallback to plain text if SVG extraction yielded nothing (e.g. Excel)
        if let ClipboardContent::Office { extracted_text, .. } = &mut office_content {
            if extracted_text.is_empty() {
                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                    if let Ok(text) = clipboard.get_text() {
                        *extracted_text = text;
                    }
                }
            }
        }
        return Ok(Some(office_content));
    }

    // For non-macOS platforms, use arboard (cross-platform)
    use arboard::Clipboard;

    // Check for files first (CF_HDROP)
    // NOTE: This uses native Windows API because arboard doesn't support files
    if let Some(files) = unsafe { read_files() } {
        return Ok(Some(ClipboardContent::Files { paths: files }));
    }

    let mut clipboard = Clipboard::new()?;

    // Try to get image first
    // NOTE: arboard returns ImageData with raw RGBA pixels, not encoded PNG
    if let Ok(img) = clipboard.get_image() {
        // Convert RGBA pixels to PNG format
        use image::{ImageBuffer, RgbaImage};

        // Create image buffer from raw RGBA data
        let rgba_image: RgbaImage =
            ImageBuffer::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())
                .ok_or_else(|| anyhow!("Failed to create image from clipboard data"))?;

        // Encode to PNG
        let mut png_data = Vec::new();
        rgba_image.write_to(
            &mut std::io::Cursor::new(&mut png_data),
            image::ImageFormat::Png,
        )?;

        return Ok(Some(ClipboardContent::Image {
            data: png_data,
            format: ImageFormat::Png,
            pdf_data: None,
        }));
    }

    // Check for HTML via Win32
    #[cfg(target_os = "windows")]
    if let Some(html_data) = unsafe { get_format_windows("HTML Format") } {
        // Find null terminator if present
        let html_len = html_data
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(html_data.len());
        let html_string = String::from_utf8_lossy(&html_data[..html_len]).to_string();
        if !html_string.trim().is_empty() {
            let plain = clipboard.get_text().unwrap_or_default();
            return Ok(Some(ClipboardContent::Html {
                html: html_string,
                plain,
            }));
        }
    }

    // Check for RTF via Win32
    #[cfg(target_os = "windows")]
    if let Some(rtf_data) = unsafe { get_format_windows("Rich Text Format") } {
        let rtf_len = rtf_data
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(rtf_data.len());
        let rtf_string = String::from_utf8_lossy(&rtf_data[..rtf_len]).to_string();
        if !rtf_string.trim().is_empty() {
            let plain = clipboard.get_text().unwrap_or_default();
            return Ok(Some(ClipboardContent::Rtf {
                rtf: rtf_string,
                plain,
            }));
        }
    }

    // Fallback to text
    if let Ok(text) = clipboard.get_text() {
        // Check if text is actually a list of files (common on Linux/Nautilus/Dolphin)
        if let Some(paths) = parse_file_uris(&text) {
            return Ok(Some(ClipboardContent::Files { paths }));
        }
        return Ok(Some(ClipboardContent::Text { content: text }));
    }

    Ok(None)
}

#[cfg(not(target_os = "macos"))]
pub fn write_clipboard(content: &ClipboardContent) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        if let ClipboardContent::Office {
            ole_data,
            ole_type,
            svg_data,
            png_data,
            pdf_data,
            ..
        } = content
        {
            use windows::Win32::System::DataExchange::{
                CloseClipboard, EmptyClipboard, OpenClipboard,
            };

            unsafe {
                if OpenClipboard(None).is_ok() {
                    let _ = EmptyClipboard();

                    // Write OLE only when we have both the data AND its captured format name.
                    // If ole_type is None, skip — guessing a format name would write garbage.
                    if let (Some(ole), Some(t)) = (ole_data, ole_type.as_deref()) {
                        set_format_windows(t, ole);
                    }
                    if let Some(svg) = svg_data {
                        set_format_windows("image/svg+xml", svg);
                    }
                    if let Some(png) = png_data {
                        set_format_windows("PNG", png);
                    }
                    if let Some(pdf) = pdf_data {
                        set_format_windows("Portable Document Format", pdf);
                    }

                    let _ = CloseClipboard();
                }
            }
            return Ok(());
        }
    }

    use arboard::Clipboard;
    let mut clipboard = Clipboard::new()?;

    match content {
        ClipboardContent::Text { content } => {
            clipboard.set_text(content)?;
        }
        ClipboardContent::Html { plain, .. } => {
            clipboard.set_text(plain)?;
        }
        ClipboardContent::Rtf { plain, .. } => {
            clipboard.set_text(plain)?;
        }
        ClipboardContent::Image { data, .. } => {
            if let Ok(img) = image::load_from_memory(data) {
                let rgba = img.into_rgba8();
                let dimensions = rgba.dimensions();
                let image_data = arboard::ImageData {
                    width: dimensions.0 as usize,
                    height: dimensions.1 as usize,
                    bytes: std::borrow::Cow::Owned(rgba.into_raw()),
                };
                clipboard.set_image(image_data)?;
            }
        }
        ClipboardContent::Files { paths } => {
            clipboard.set_text(paths.join("\n"))?;
        }
        ClipboardContent::Office { extracted_text, .. } => {
            if !extracted_text.is_empty() {
                clipboard.set_text(extracted_text)?;
            }
        }
    }

    Ok(())
}

fn parse_file_uris(text: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return None;
    }

    let mut paths = Vec::new();
    for line in lines {
        // Check for file:// URI
        if line.starts_with("file://") {
            if let Ok(url) = url::Url::parse(line) {
                if let Ok(path) = url.to_file_path() {
                    paths.push(path.to_string_lossy().into_owned());
                    continue;
                }
            }
        }

        // Check for absolute path
        let path = std::path::Path::new(line);
        if path.is_absolute() && path.exists() {
            paths.push(line.to_string());
            continue;
        }

        // If any line is NOT a file, treat whole thing as text
        return None;
    }

    if paths.is_empty() {
        None
    } else {
        Some(paths)
    }
}

#[cfg(target_os = "windows")]
pub fn get_active_app_name() -> Option<String> {
    unsafe { get_active_app_name_windows() }
}

#[cfg(target_os = "linux")]
pub fn get_active_app_name() -> Option<String> {
    crate::services::clipboard_platform_linux::get_active_app_name()
}

#[cfg(target_os = "macos")]
pub fn get_active_app_name() -> Option<String> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};
    use objc2_foundation::NSString;

    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();

        // Get frontmost application - this returns Option<Retained<NSRunningApplication>>
        let front_app: Option<Retained<NSRunningApplication>> = workspace.frontmostApplication();

        // Check if we got a valid app
        let app = front_app?;

        // Get localized name - this returns Option<Retained<NSString>>
        let app_name: Option<Retained<NSString>> = app.localizedName();

        // Convert to String
        app_name.map(|name| name.to_string())
    }
}

#[cfg(target_os = "windows")]
unsafe fn read_files() -> Option<Vec<String>> {
    // 1. Open Clipboard
    // NOTE: passing None means we associate with current task
    if OpenClipboard(None).is_err() {
        return None;
    }

    // Ensure we close clipboard even if we return early
    let _cleanup = CloseClipboardGuard;

    // 2. Get Data for CF_HDROP (15)
    // CF_HDROP is the standard format for file lists
    let handle = match GetClipboardData(15) {
        Ok(h) => h,
        Err(_) => return None,
    };

    if handle.is_invalid() {
        return None;
    }

    // 3. Lock Global Memory to get pointer
    // GetClipboardData returns HANDLE, GlobalLock expects HGLOBAL
    let hglobal = std::mem::transmute::<HANDLE, HGLOBAL>(handle);
    let ptr = GlobalLock(hglobal);
    if ptr.is_null() {
        return None;
    }

    // 4. Use DragQueryFileW to get file count
    // 0xFFFFFFFF means "return count of files"
    // ptr as *mut _ casts void* to HDROP
    let hdrop = std::mem::transmute::<*mut std::ffi::c_void, HDROP>(ptr);
    let file_count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);

    if file_count == 0 {
        GlobalUnlock(hglobal).ok();
        return None;
    }

    let mut paths = Vec::new();
    for i in 0..file_count {
        // Get length of filename first (passing None)
        let len = DragQueryFileW(hdrop, i, None);
        if len > 0 {
            // Allocate buffer (+1 for null terminator)
            let mut buffer = vec![0u16; (len + 1) as usize];
            // Read filename into buffer
            let copied = DragQueryFileW(hdrop, i, Some(&mut buffer));
            if copied > 0 {
                // Convert UTF-16 to String
                if let Ok(path) = String::from_utf16(&buffer[0..copied as usize]) {
                    paths.push(path);
                }
            }
        }
    }

    GlobalUnlock(hglobal).ok();

    // cleanup guard drops here, calling CloseClipboard
    if paths.is_empty() {
        None
    } else {
        Some(paths)
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_active_app_name_windows() -> Option<String> {
    let hwnd = GetForegroundWindow();
    if hwnd.0.is_null() {
        return None;
    }

    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return None;
    }

    let process_handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);

    let handle = match process_handle {
        Ok(h) => h,
        Err(_) => return None,
    };

    let mut buffer = [0u16; MAX_PATH as usize];
    // GetModuleFileNameExW expects Option<HANDLE> and Option<HMODULE>
    let len = GetModuleFileNameExW(Some(handle), None, &mut buffer);
    let _ = windows::Win32::Foundation::CloseHandle(handle);

    if len == 0 {
        return None;
    }

    let full_path = String::from_utf16_lossy(&buffer[..len as usize]);
    std::path::Path::new(&full_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

#[cfg(target_os = "windows")]
struct CloseClipboardGuard;

#[cfg(target_os = "windows")]
impl Drop for CloseClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_format_windows(format_name: &str) -> Option<Vec<u8>> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    let wide_name: Vec<u16> = format_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let format = RegisterClipboardFormatW(PCWSTR::from_raw(wide_name.as_ptr()));
    if format == 0 {
        return None;
    }

    if OpenClipboard(None).is_err() {
        return None;
    }

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    let _guard = ClipboardGuard;

    let handle = match GetClipboardData(format) {
        Ok(h) => h,
        Err(_) => return None,
    };
    if handle.is_invalid() {
        return None;
    }

    let hglobal = std::mem::transmute::<HANDLE, HGLOBAL>(handle);
    let ptr = GlobalLock(hglobal);
    if ptr.is_null() {
        return None;
    }

    let size = GlobalSize(hglobal);
    let data = std::slice::from_raw_parts(ptr as *const u8, size as usize).to_vec();
    GlobalUnlock(hglobal).ok();

    Some(data)
}

#[cfg(target_os = "windows")]
unsafe fn get_all_formats_windows() -> Vec<(u32, String)> {
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EnumClipboardFormats, GetClipboardFormatNameW, OpenClipboard,
    };

    let mut formats = Vec::new();

    if OpenClipboard(None).is_err() {
        return formats;
    }

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    let _guard = ClipboardGuard;

    let mut format = 0;
    loop {
        format = EnumClipboardFormats(format);
        if format == 0 {
            break;
        }

        let mut name_buf = [0u16; 256];
        let len = GetClipboardFormatNameW(format, &mut name_buf);
        if len > 0 {
            let name = String::from_utf16_lossy(&name_buf[..len as usize]);
            formats.push((format, name));
        }
    }

    formats
}

#[cfg(target_os = "windows")]
unsafe fn read_office_content_windows() -> Option<ClipboardContent> {
    let formats = get_all_formats_windows();

    // Step 1: Detect if this is Office and which app it's from
    // We collect all possible Office formats and pick the largest one
    // to ensure we capture the main package (e.g., full workbook vs single cell metadata)
    let mut candidates: Vec<(String, Vec<u8>, String)> = Vec::new();

    for (_, format_name) in &formats {
        let name_lower = format_name.to_lowercase();

        // Skip internal/theme formats that shouldn't be the primary payload
        if name_lower.contains("internal theme")
            || name_lower.contains("color scheme")
            || name_lower.contains("activeclipboard")
        {
            continue;
        }

        let mut app_category = None;

        // --- PowerPoint Format Detection ---
        if name_lower.contains("powerpoint") || format_name == "Art::GVML ClipFormat" {
            app_category = Some("Microsoft PowerPoint");
        }
        // --- Excel Format Detection ---
        else if name_lower.contains("excel")
            || name_lower.contains("biff")
            || name_lower.contains("xml spreadsheet")
        {
            app_category = Some("Microsoft Excel");
        }
        // --- Word Format Detection ---
        else if name_lower.contains("word") {
            app_category = Some("Microsoft Word");
        }
        // --- Generic OLE/Embed Source ---
        else if format_name == "Embed Source" {
            // Generic OLE object, often used by Office apps
            app_category = Some("Microsoft Office");
        }

        if let Some(category) = app_category {
            if let Some(data) = get_format_windows(format_name) {
                candidates.push((format_name.clone(), data, category.to_string()));
            }
        }
    }

    // Step 2: Grab the largest native format as our primary package
    let ole_type;
    let ole_data;
    let source_app;

    if let Some((uti, data, category)) = candidates.into_iter().max_by_key(|(_, d, _)| d.len()) {
        ole_type = Some(uti);
        ole_data = Some(data);
        source_app = category;
    } else {
        // If we found NO native office formats, abort. This is not an Office payload!
        return None;
    }

    // Step 3: Extract visual/preview formats
    let svg_data = get_format_windows("image/svg+xml");
    let png_data = get_format_windows("PNG");
    let pdf_data = get_format_windows("Portable Document Format");

    // Step 4: Extract text styling formats (HTML, RTF)
    let mut html_data = None;
    if let Some(data) = get_format_windows("HTML Format") {
        let len = data.iter().position(|&b| b == 0).unwrap_or(data.len());
        let raw_html = String::from_utf8_lossy(&data[..len]).to_string();

        // Parse Windows HTML Format header (e.g., StartHTML:00000100)
        let mut start_idx = 0;
        let mut end_idx = raw_html.len();

        for line in raw_html.lines().take(15) {
            if line.starts_with("StartHTML:") {
                if let Ok(val) = line[10..].trim().parse::<usize>() {
                    start_idx = val;
                }
            } else if line.starts_with("EndHTML:") {
                if let Ok(val) = line[8..].trim().parse::<usize>() {
                    end_idx = val;
                }
            }
        }

        // Sanity check indices
        if start_idx < raw_html.len() && end_idx <= raw_html.len() && start_idx < end_idx {
            html_data = Some(raw_html[start_idx..end_idx].to_string());
        } else {
            html_data = Some(raw_html); // Fallback to raw if header is malformed
        }
    }

    let mut rtf_data = None;
    if let Some(data) = get_format_windows("Rich Text Format") {
        let len = data.iter().position(|&b| b == 0).unwrap_or(data.len());
        rtf_data = Some(String::from_utf8_lossy(&data[..len]).to_string());
    }

    // Step 5: Extract plain text (for search indexing and fallback)
    let mut extracted_text = String::new();
    if let Some(ref svg) = svg_data {
        let svg_str = String::from_utf8_lossy(svg);
        extracted_text = extract_svg_text(&svg_str);
    }
    // Note: If extracted_text is empty (e.g. Excel has no SVG),
    // the fallback to `arboard` plaintext occurs in `read_clipboard()`.

    Some(ClipboardContent::Office {
        ole_data,
        ole_type,
        extra_types: vec![],
        svg_data,
        pdf_data,
        png_data,
        html_data,
        rtf_data,
        extracted_text,
        source_app,
    })
}

#[cfg(target_os = "windows")]
unsafe fn set_format_windows(format_name: &str, data: &[u8]) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{RegisterClipboardFormatW, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GHND};

    let wide_name: Vec<u16> = format_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let format = RegisterClipboardFormatW(PCWSTR::from_raw(wide_name.as_ptr()));
    if format == 0 {
        return false;
    }

    let hglobal = match GlobalAlloc(GHND, data.len()) {
        Ok(h) => h,
        Err(_) => return false,
    };
    if hglobal.is_invalid() {
        return false;
    }

    let ptr = GlobalLock(hglobal);
    if !ptr.is_null() {
        std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, data.len());
        GlobalUnlock(hglobal).ok();

        // Ownership of the HGLOBAL is passed to the clipboard. We should not free it.
        let handle = std::mem::transmute::<HGLOBAL, HANDLE>(hglobal);
        SetClipboardData(format, Some(handle)).is_ok()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_file_uris() {
        // Test valid file URIs
        #[cfg(not(target_os = "windows"))]
        let input = "file:///home/user/test.txt\nfile:///home/user/image.png";

        #[cfg(target_os = "windows")]
        let input = "file:///C:/Users/test.txt\nfile:///C:/Users/image.png";

        let paths = parse_file_uris(input).unwrap();
        assert_eq!(paths.len(), 2);

        // Test absolute paths
        // We use forward slashes for generic test, assuming platform agnostic handling or linux style
        // On Windows checking if absolute
        let valid_path = std::env::current_exe().unwrap();
        let valid_path_str = valid_path.to_string_lossy();

        // Only run absolute path test if the path exists (which current_exe does)
        // parse_file_uris checks for existence for raw paths
        if std::path::Path::new(&*valid_path_str).is_absolute() {
            let paths = parse_file_uris(&valid_path_str).unwrap();
            assert_eq!(paths.len(), 1);

            // Test mixed text (should fail)
            let input = format!("{}\nSome random text", valid_path_str);
            assert!(parse_file_uris(&input).is_none());
        }

        // Test just text
        let input = "Hello world";
        assert!(parse_file_uris(input).is_none());
    }

    #[test]
    fn test_parse_file_uris_with_temp_file() {
        use std::io::Write;
        let mut temp_file = tempfile::NamedTempFile::new().unwrap();
        write!(temp_file, "content").unwrap();
        let path = temp_file.path().to_str().unwrap().to_string();

        let input = path.clone();

        // On Windows checking if absolute
        if std::path::Path::new(&input).is_absolute() {
            let paths = parse_file_uris(&input).unwrap();
            assert_eq!(paths[0], path);
        }
    }
}
