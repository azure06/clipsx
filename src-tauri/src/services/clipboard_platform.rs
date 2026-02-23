#![allow(dead_code)]
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
    appkit::{
        NSPasteboard, NSPasteboardTypeHTML, NSPasteboardTypePNG, NSPasteboardTypeRTF,
        NSPasteboardTypeString, NSPasteboardTypeTIFF,
    },
    base::{id, nil},
    foundation::NSString,
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
    Text { content: String },
    Html { html: String, plain: String },
    Rtf { rtf: String, plain: String },
    Image { data: Vec<u8>, format: ImageFormat },
    Files { paths: Vec<String> },
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

    let text = std::ffi::CStr::from_ptr(c_str)
        .to_string_lossy()
        .into_owned();
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
unsafe fn read_image(pasteboard: id) -> Option<(Vec<u8>, ImageFormat)> {
    use cocoa::base::nil;
    use cocoa::foundation::NSString;

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
    use cocoa::base::nil;
    use cocoa::foundation::NSString;

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
    use cocoa::appkit::NSWorkspace;
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;

    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let front_app: id = msg_send![workspace, frontmostApplication];

        if front_app == nil {
            return None;
        }

        let app_name: id = msg_send![front_app, localizedName];
        if app_name == nil {
            return None;
        }

        let c_str: *const i8 = msg_send![app_name, UTF8String];
        if c_str.is_null() {
            return None;
        }

        Some(
            std::ffi::CStr::from_ptr(c_str)
                .to_string_lossy()
                .into_owned(),
        )
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
