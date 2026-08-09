use crate::history::{CapturedPayload, CapturedRepresentation, CapturedSnapshot};
use anyhow::{bail, Context, Result};
use arboard::{Clipboard, ImageData};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::Duration,
};

static SELF_WRITE_TOKEN: AtomicU64 = AtomicU64::new(u64::MAX);
pub fn is_self_write_token(token: u64) -> bool {
    SELF_WRITE_TOKEN.load(Ordering::Acquire) == token
}

pub trait ClipboardAdapter: Send {
    fn snapshot_token(&mut self) -> Result<u64>;
    fn capture_once(&mut self, token: u64) -> Result<CapturedSnapshot>;
    fn write(&mut self, representations: &[CapturedRepresentation]) -> Result<u64>;
}

pub struct SystemClipboardAdapter {
    fallback_token: u64,
}
impl SystemClipboardAdapter {
    pub fn new() -> Self {
        Self { fallback_token: 0 }
    }
}

impl ClipboardAdapter for SystemClipboardAdapter {
    fn snapshot_token(&mut self) -> Result<u64> {
        #[cfg(target_os = "windows")]
        {
            Ok(
                unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
                    as u64,
            )
        }
        #[cfg(target_os = "macos")]
        {
            macos_change_count()
        }
        #[cfg(target_os = "linux")]
        {
            x11_owner_token().or(Ok(self.fallback_token))
        }
    }
    fn capture_once(&mut self, token: u64) -> Result<CapturedSnapshot> {
        let mut clipboard = Clipboard::new().context("clipboard unavailable")?;
        let mut reps = Vec::new();
        if let Ok(text) = clipboard.get_text() {
            if !text.is_empty() {
                #[cfg(target_os = "linux")]
                if let Some(files) = parse_uri_list(&text) {
                    reps.push(CapturedRepresentation {
                        format_key: "linux_x11:text/uri-list".into(),
                        canonical_mime_type: Some("text/uri-list".into()),
                        native_type: Some("text/uri-list".into()),
                        platform: "linux_x11".into(),
                        capture_priority: 10,
                        payload: CapturedPayload::Files(files),
                    });
                }
                reps.push(CapturedRepresentation {
                    format_key: format!("{}:text/plain", platform_name()),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: None,
                    platform: platform_name().into(),
                    capture_priority: 100,
                    payload: CapturedPayload::Text(text),
                });
            }
        }
        #[cfg(target_os = "windows")]
        unsafe {
            capture_windows_formats(&mut reps)?;
        }
        #[cfg(target_os = "macos")]
        unsafe {
            capture_macos_formats(&mut reps)?;
        }
        #[cfg(target_os = "linux")]
        capture_x11_formats(&mut reps)?;
        if let Ok(image) = clipboard.get_image() {
            reps.push(CapturedRepresentation {
                format_key: format!("{}:image/png", platform_name()),
                canonical_mime_type: Some("image/png".into()),
                native_type: Some(
                    if cfg!(target_os = "windows") {
                        "normalized:DIB"
                    } else {
                        "normalized:image"
                    }
                    .into(),
                ),
                platform: platform_name().into(),
                capture_priority: 200,
                payload: CapturedPayload::Binary(encode_png(image)?),
            });
        }
        if reps.is_empty() {
            bail!("clipboard has no supported representations")
        }
        self.fallback_token = self.fallback_token.wrapping_add(1);
        Ok(CapturedSnapshot {
            token,
            source_app_name: active_app_name(),
            source_app_id: None,
            representations: reps,
        })
    }
    fn write(&mut self, reps: &[CapturedRepresentation]) -> Result<u64> {
        #[cfg(target_os = "windows")]
        unsafe {
            write_windows_formats(reps)?;
            let token = self.snapshot_token()?;
            SELF_WRITE_TOKEN.store(token, Ordering::Release);
            Ok(token)
        }
        #[cfg(target_os = "macos")]
        unsafe {
            write_macos_formats(reps)?;
            let token = self.snapshot_token()?;
            SELF_WRITE_TOKEN.store(token, Ordering::Release);
            Ok(token)
        }
        #[cfg(target_os = "linux")]
        {
            let mut clipboard = Clipboard::new().context("clipboard unavailable")?;
            if let Some(bytes) = reps.iter().find_map(|r| match &r.payload {
                CapturedPayload::Binary(bytes)
                    if r.canonical_mime_type.as_deref() == Some("image/png") =>
                {
                    Some(bytes)
                }
                _ => None,
            }) {
                let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)?
                    .into_rgba8();
                let (width, height) = image.dimensions();
                clipboard.set_image(ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: std::borrow::Cow::Owned(image.into_raw()),
                })?;
            } else if let Some(files) = reps.iter().find_map(|r| match &r.payload {
                CapturedPayload::Files(files) => Some(files),
                _ => None,
            }) {
                clipboard.set_text(files.join("\r\n"))?;
            } else if let Some(text) = reps.iter().find_map(|r| match &r.payload {
                CapturedPayload::Text(value) => Some(value),
                _ => None,
            }) {
                clipboard.set_text(text.to_string())?;
            } else {
                bail!("no writeable representation is available")
            }
            let token = self.snapshot_token()?;
            SELF_WRITE_TOKEN.store(token, Ordering::Release);
            Ok(token)
        }
    }
}

pub fn capture_coherent(adapter: &mut dyn ClipboardAdapter) -> Result<CapturedSnapshot> {
    let delays = [25, 75, 150];
    for (attempt, delay) in delays.into_iter().enumerate() {
        let before = adapter.snapshot_token()?;
        match adapter.capture_once(before) {
            Ok(snapshot) if adapter.snapshot_token()? == before || before == 0 => {
                return Ok(snapshot)
            }
            Ok(_) => {}
            Err(error) if attempt == 2 => return Err(error),
            Err(_) => {}
        }
        thread::sleep(Duration::from_millis(delay));
    }
    bail!("clipboard changed during capture after three retries")
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux_x11"
    }
}
fn encode_png(image: ImageData<'_>) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    use image::ImageEncoder;
    image::codecs::png::PngEncoder::new(&mut out).write_image(
        &image.bytes,
        image.width.try_into()?,
        image.height.try_into()?,
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(out)
}
#[cfg(target_os = "windows")]
fn active_app_name() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };
    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, Some(&mut pid));
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        std::path::Path::new(&String::from_utf16_lossy(&buffer[..length as usize]))
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned())
    }
}
#[cfg(target_os = "macos")]
fn active_app_name() -> Option<String> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: id = msg_send![workspace, frontmostApplication];
        if app == nil {
            return None;
        }
        let name: id = msg_send![app, localizedName];
        if name == nil {
            return None;
        }
        let ptr: *const std::ffi::c_char = msg_send![name, UTF8String];
        (!ptr.is_null()).then(|| std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned())
    }
}
#[cfg(target_os = "linux")]
fn active_app_name() -> Option<String> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{AtomEnum, ConnectionExt},
    };
    let (conn, screen) = x11rb::connect(None).ok()?;
    let root = conn.setup().roots[screen].root;
    let active_atom = conn
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let active = conn
        .get_property(false, root, active_atom, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()?;
    let name_atom = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let utf8 = conn
        .intern_atom(false, b"UTF8_STRING")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let name = conn
        .get_property(false, active, name_atom, utf8, 0, 1024)
        .ok()?
        .reply()
        .ok()?
        .value;
    String::from_utf8(name)
        .ok()
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn macos_change_count() -> Result<u64> {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
        let count: i64 = msg_send![pb, changeCount];
        Ok(count as u64)
    }
}

#[cfg(target_os = "macos")]
unsafe fn write_macos_formats(reps: &[CapturedRepresentation]) -> Result<()> {
    use cocoa::{
        base::{id, nil},
        foundation::NSString,
    };
    use objc::{class, msg_send, sel, sel_impl};
    let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
    let _: i64 = msg_send![pb, clearContents];
    let mut written = 0;
    for rep in reps {
        let Some(native) = rep
            .native_type
            .as_deref()
            .filter(|native| *native != "normalized:image")
            .or(match rep.canonical_mime_type.as_deref() {
                Some("text/plain") => Some("public.utf8-plain-text"),
                Some("text/html") => Some("public.html"),
                Some("text/rtf") => Some("public.rtf"),
                Some("image/png") => Some("public.png"),
                Some("image/jpeg") => Some("public.jpeg"),
                Some("image/tiff") => Some("public.tiff"),
                Some("application/pdf") => Some("com.adobe.pdf"),
                Some("image/svg+xml") => Some("public.svg-image"),
                _ => None,
            })
        else {
            continue;
        };
        let allowed = matches!(
            native,
            "public.utf8-plain-text"
                | "public.html"
                | "public.rtf"
                | "public.png"
                | "public.jpeg"
                | "public.tiff"
                | "com.adobe.pdf"
                | "public.svg-image"
                | "public.file-url"
        ) || native.starts_with("com.microsoft.");
        if !allowed {
            continue;
        }
        let ty: id = NSString::alloc(nil).init_str(native);
        let bytes = match &rep.payload {
            CapturedPayload::Text(value) => value.as_bytes(),
            CapturedPayload::Binary(value) => value.as_slice(),
            CapturedPayload::Files(files) => {
                files.first().map(String::as_bytes).unwrap_or_default()
            }
        };
        let data: id = msg_send![class!(NSData),dataWithBytes:bytes.as_ptr() length:bytes.len()];
        let success: bool = msg_send![pb,setData:data forType:ty];
        if success {
            written += 1
        }
    }
    if written == 0 {
        bail!("no supported representation remained for reconstruction")
    }
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn capture_macos_formats(reps: &mut Vec<CapturedRepresentation>) -> Result<()> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
    let types: id = msg_send![pb, types];
    if types == nil {
        return Ok(());
    }
    let count: usize = msg_send![types, count];
    for index in 0..count {
        let ty: id = msg_send![types,objectAtIndex:index];
        let ptr: *const std::ffi::c_char = msg_send![ty, UTF8String];
        if ptr.is_null() {
            continue;
        }
        let name = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
        let data: id = msg_send![pb,dataForType:ty];
        if data == nil {
            if matches!(
                name.as_str(),
                "public.utf8-plain-text"
                    | "public.html"
                    | "public.rtf"
                    | "public.file-url"
                    | "public.png"
                    | "public.jpeg"
                    | "public.tiff"
                    | "com.adobe.pdf"
                    | "public.svg-image"
            ) || name.starts_with("com.microsoft.")
            {
                bail!("supported macOS pasteboard type {name} was unreadable")
            }
            continue;
        }
        let length: usize = msg_send![data, length];
        let bytes_ptr: *const u8 = msg_send![data, bytes];
        if bytes_ptr.is_null() {
            continue;
        }
        let bytes = std::slice::from_raw_parts(bytes_ptr, length).to_vec();
        let (mime, payload) = match name.as_str() {
            "public.utf8-plain-text" => (
                Some("text/plain".into()),
                CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            ),
            "public.html" => (
                Some("text/html".into()),
                CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            ),
            "public.rtf" => (
                Some("text/rtf".into()),
                CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            ),
            "public.file-url" => {
                let value = String::from_utf8_lossy(&bytes)
                    .trim_matches(char::from(0))
                    .to_string();
                (None, CapturedPayload::Files(vec![value]))
            }
            "public.png" => (Some("image/png".into()), CapturedPayload::Binary(bytes)),
            "public.jpeg" => (Some("image/jpeg".into()), CapturedPayload::Binary(bytes)),
            "public.tiff" => (Some("image/tiff".into()), CapturedPayload::Binary(bytes)),
            "com.adobe.pdf" => (
                Some("application/pdf".into()),
                CapturedPayload::Binary(bytes),
            ),
            "public.svg-image" => (Some("image/svg+xml".into()), CapturedPayload::Binary(bytes)),
            _ if name.starts_with("com.microsoft.") => (None, CapturedPayload::Binary(bytes)),
            _ => continue,
        };
        reps.push(CapturedRepresentation {
            format_key: format!("macos:{name}"),
            canonical_mime_type: mime,
            native_type: Some(name),
            platform: "macos".into(),
            capture_priority: 20,
            payload,
        });
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn x11_owner_token() -> Result<u64> {
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{
                AtomEnum, ConnectionExt, CreateWindowAux, WindowClass, COPY_DEPTH_FROM_PARENT,
                CURRENT_TIME,
            },
            Event,
        },
    };
    let (conn, screen_index) = x11rb::connect(None)?;
    let atom = conn.intern_atom(false, b"CLIPBOARD")?.reply()?.atom;
    let owner = conn.get_selection_owner(atom)?.reply()?.owner;
    if owner == 0 {
        return Ok(0);
    }
    let timestamp = conn.intern_atom(false, b"TIMESTAMP")?.reply()?.atom;
    let property = conn.intern_atom(false, b"CLIPSX_TIMESTAMP")?.reply()?.atom;
    let window = conn.generate_id()?;
    let root = conn.setup().roots[screen_index].root;
    conn.create_window(
        COPY_DEPTH_FROM_PARENT,
        window,
        root,
        0,
        0,
        1,
        1,
        0,
        WindowClass::INPUT_OUTPUT,
        0,
        &CreateWindowAux::new(),
    )?
    .check()?;
    conn.convert_selection(window, atom, timestamp, property, CURRENT_TIME)?
        .check()?;
    conn.flush()?;
    let deadline = std::time::Instant::now() + Duration::from_millis(50);
    let mut value = 0u32;
    while std::time::Instant::now() < deadline {
        if let Some(Event::SelectionNotify(event)) = conn.poll_for_event()? {
            if event.property != AtomEnum::NONE.into() {
                let reply = conn
                    .get_property(false, window, property, AtomEnum::INTEGER, 0, 1)?
                    .reply()?;
                value = reply
                    .value32()
                    .and_then(|mut values| values.next())
                    .unwrap_or_default();
                break;
            }
        }
        thread::sleep(Duration::from_millis(1));
    }
    let _ = conn.destroy_window(window);
    let _ = conn.flush();
    Ok(((owner as u64) << 32) | value as u64)
}

#[cfg(target_os = "linux")]
fn parse_uri_list(text: &str) -> Option<Vec<String>> {
    let files: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("file://"))
        .map(str::to_string)
        .collect();
    (!files.is_empty()).then_some(files)
}

#[cfg(target_os = "linux")]
fn capture_x11_formats(reps: &mut Vec<CapturedRepresentation>) -> Result<()> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{
            ConnectionExt, CreateWindowAux, EventMask, WindowClass, COPY_DEPTH_FROM_PARENT,
        },
    };
    let (conn, screen) = x11rb::connect(None)?;
    let selection = conn.intern_atom(false, b"CLIPBOARD")?.reply()?.atom;
    let targets = conn.intern_atom(false, b"TARGETS")?.reply()?.atom;
    let property = conn.intern_atom(false, b"CLIPSX_CAPTURE")?.reply()?.atom;
    let window = conn.generate_id()?;
    let root = conn.setup().roots[screen].root;
    conn.create_window(
        COPY_DEPTH_FROM_PARENT,
        window,
        root,
        0,
        0,
        1,
        1,
        0,
        WindowClass::INPUT_OUTPUT,
        0,
        &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
    )?
    .check()?;
    let (_, target_bytes) = x11_read_target(&conn, window, selection, targets, property)?;
    for atom in target_bytes
        .chunks_exact(4)
        .map(|bytes| u32::from_ne_bytes(bytes.try_into().unwrap()))
    {
        let name = String::from_utf8_lossy(&conn.get_atom_name(atom)?.reply()?.name).into_owned();
        if matches!(
            name.as_str(),
            "TARGETS" | "TIMESTAMP" | "MULTIPLE" | "SAVE_TARGETS" | "UTF8_STRING" | "STRING"
        ) {
            continue;
        }
        let supported = matches!(
            name.as_str(),
            "text/plain"
                | "text/plain;charset=utf-8"
                | "text/html"
                | "text/rtf"
                | "application/rtf"
                | "text/uri-list"
                | "image/png"
        );
        let (_, bytes) = match x11_read_target(&conn, window, selection, atom, property) {
            Ok(value) => value,
            Err(error) if supported => return Err(error),
            Err(_) => continue,
        };
        if bytes.is_empty() {
            continue;
        }
        let (mime, payload) = match name.as_str() {
            "text/plain" | "text/plain;charset=utf-8" => (
                Some("text/plain".into()),
                CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            ),
            "text/html" => (
                Some("text/html".into()),
                CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            ),
            "text/rtf" | "application/rtf" => (
                Some("text/rtf".into()),
                CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            ),
            "text/uri-list" => (
                Some("text/uri-list".into()),
                CapturedPayload::Files(
                    String::from_utf8_lossy(&bytes)
                        .lines()
                        .map(str::trim)
                        .filter(|v| !v.is_empty() && !v.starts_with('#'))
                        .map(str::to_string)
                        .collect(),
                ),
            ),
            "image/png" => (Some("image/png".into()), CapturedPayload::Binary(bytes)),
            _ => (None, CapturedPayload::Binary(bytes)),
        };
        reps.push(CapturedRepresentation {
            format_key: format!("linux_x11:{name}"),
            canonical_mime_type: mime,
            native_type: Some(name),
            platform: "linux_x11".into(),
            capture_priority: 50,
            payload,
        });
    }
    let _ = conn.destroy_window(window);
    let _ = conn.flush();
    Ok(())
}
#[cfg(target_os = "linux")]
fn x11_read_target(
    conn: &x11rb::rust_connection::RustConnection,
    window: u32,
    selection: u32,
    target: u32,
    property: u32,
) -> Result<(u32, Vec<u8>)> {
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{AtomEnum, ConnectionExt, CURRENT_TIME},
            Event,
        },
    };
    conn.convert_selection(window, selection, target, property, CURRENT_TIME)?
        .check()?;
    conn.flush()?;
    let deadline = std::time::Instant::now() + Duration::from_millis(150);
    while std::time::Instant::now() < deadline {
        if let Some(Event::SelectionNotify(event)) = conn.poll_for_event()? {
            if event.property == AtomEnum::NONE.into() {
                bail!("X11 selection target unavailable")
            }
            let reply = conn
                .get_property(false, window, property, AtomEnum::ANY, 0, u32::MAX)?
                .reply()?;
            let incr = conn.intern_atom(false, b"INCR")?.reply()?.atom;
            if reply.type_ == incr {
                conn.delete_property(window, property)?.check()?;
                conn.flush()?;
                let mut collected = Vec::new();
                let chunk_deadline = std::time::Instant::now() + Duration::from_secs(2);
                while std::time::Instant::now() < chunk_deadline {
                    if let Some(Event::PropertyNotify(event)) = conn.poll_for_event()? {
                        if event.atom != property {
                            continue;
                        }
                        let chunk = conn
                            .get_property(true, window, property, AtomEnum::ANY, 0, u32::MAX)?
                            .reply()?;
                        if chunk.value.is_empty() {
                            return Ok((chunk.type_, collected));
                        }
                        collected.extend_from_slice(&chunk.value);
                        if collected.len() > 104_857_600 {
                            bail!("X11 INCR transfer exceeds snapshot hard limit")
                        }
                    }
                    thread::sleep(Duration::from_millis(1));
                }
                bail!("X11 INCR transfer timed out")
            }
            return Ok((reply.type_, reply.value));
        }
        thread::sleep(Duration::from_millis(1));
    }
    bail!("X11 selection target timed out")
}

#[cfg(target_os = "windows")]
unsafe fn capture_windows_formats(reps: &mut Vec<CapturedRepresentation>) -> Result<()> {
    use windows::Win32::{
        Foundation::HGLOBAL,
        System::{
            DataExchange::{
                CloseClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardFormatNameW,
                OpenClipboard,
            },
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
        UI::Shell::{DragQueryFileW, HDROP},
    };
    if OpenClipboard(None).is_err() {
        return Ok(());
    }
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    let _guard = Guard;
    if let Ok(handle) = GetClipboardData(15) {
        let drop_handle = HDROP(handle.0);
        let count = DragQueryFileW(drop_handle, 0xFFFF_FFFF, None);
        let mut files = Vec::new();
        for index in 0..count {
            let length = DragQueryFileW(drop_handle, index, None);
            let mut buffer = vec![0u16; length as usize + 1];
            DragQueryFileW(drop_handle, index, Some(&mut buffer));
            files.push(String::from_utf16_lossy(&buffer[..length as usize]));
        }
        if !files.is_empty() {
            reps.push(CapturedRepresentation {
                format_key: "windows:CF_HDROP".into(),
                canonical_mime_type: Some("text/uri-list".into()),
                native_type: Some("CF_HDROP".into()),
                platform: "windows".into(),
                capture_priority: 5,
                payload: CapturedPayload::Files(files),
            });
        }
    }
    let mut format = 0u32;
    loop {
        format = EnumClipboardFormats(format);
        if format == 0 {
            break;
        }
        let mut name_buf = [0u16; 256];
        let len = GetClipboardFormatNameW(format, &mut name_buf);
        if len == 0 {
            continue;
        }
        let name = String::from_utf16_lossy(&name_buf[..len as usize]);
        let supported_name = matches!(
            name.as_str(),
            "HTML Format"
                | "Rich Text Format"
                | "PNG"
                | "Portable Document Format"
                | "image/svg+xml"
        ) || {
            let value = name.to_ascii_lowercase();
            value.contains("office")
                || value.contains("object")
                || value.contains("powerpoint")
                || value.contains("excel")
                || value.contains("word")
        };
        let handle = match GetClipboardData(format) {
            Ok(v) => v,
            Err(error) if supported_name => return Err(error.into()),
            Err(_) => continue,
        };
        let global = std::mem::transmute::<windows::Win32::Foundation::HANDLE, HGLOBAL>(handle);
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            if supported_name {
                bail!("supported Windows clipboard format {name} was unreadable")
            }
            continue;
        }
        let size = GlobalSize(global);
        let bytes = std::slice::from_raw_parts(ptr.cast::<u8>(), size).to_vec();
        let _ = GlobalUnlock(global);
        let trimmed = &bytes[..bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len())];
        let lower = name.to_ascii_lowercase();
        let (mime, payload) = if name == "HTML Format" {
            (
                Some("text/html".into()),
                CapturedPayload::Text(parse_windows_html(trimmed)),
            )
        } else if name == "Rich Text Format" {
            (
                Some("text/rtf".into()),
                CapturedPayload::Text(String::from_utf8_lossy(trimmed).into_owned()),
            )
        } else {
            let mime = if lower == "png" {
                Some("image/png".into())
            } else if lower.contains("svg") {
                Some("image/svg+xml".into())
            } else if lower.contains("pdf") {
                Some("application/pdf".into())
            } else {
                None
            };
            (mime, CapturedPayload::Binary(bytes))
        };
        reps.push(CapturedRepresentation {
            format_key: format!("windows:{name}"),
            canonical_mime_type: mime,
            native_type: Some(name),
            platform: "windows".into(),
            capture_priority: if lower.contains("office") || lower.contains("object") {
                10
            } else {
                50
            },
            payload,
        });
    }
    Ok(())
}
#[cfg(target_os = "windows")]
fn parse_windows_html(bytes: &[u8]) -> String {
    let raw = String::from_utf8_lossy(bytes);
    let mut start = 0;
    let mut end = raw.len();
    for line in raw.lines().take(15) {
        if let Some(v) = line.strip_prefix("StartHTML:") {
            start = v.trim().parse().unwrap_or(0)
        }
        if let Some(v) = line.strip_prefix("EndHTML:") {
            end = v.trim().parse().unwrap_or(raw.len())
        }
    }
    raw.get(start..end).unwrap_or(&raw).to_string()
}

#[cfg(target_os = "windows")]
unsafe fn write_windows_formats(reps: &[CapturedRepresentation]) -> Result<()> {
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
    if OpenClipboard(None).is_err() {
        bail!("cannot open clipboard for reconstruction")
    }
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    let _guard = Guard;
    EmptyClipboard()?;
    let mut written = 0;
    for rep in reps {
        match &rep.payload {
            CapturedPayload::Text(value)
                if rep.canonical_mime_type.as_deref() == Some("text/plain") =>
            {
                let mut bytes: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
                bytes.extend_from_slice(&[0, 0]);
                if set_windows_format(13, &bytes) {
                    written += 1
                }
            }
            CapturedPayload::Text(value)
                if rep.canonical_mime_type.as_deref() == Some("text/html") =>
            {
                let wrapped = windows_html_wrapper(value);
                let format = register_windows_format("HTML Format");
                if set_windows_format(format, wrapped.as_bytes()) {
                    written += 1
                }
            }
            CapturedPayload::Text(value)
                if rep.canonical_mime_type.as_deref() == Some("text/rtf") =>
            {
                let format = register_windows_format("Rich Text Format");
                if set_windows_format(format, value.as_bytes()) {
                    written += 1
                }
            }
            CapturedPayload::Files(files) => {
                let mut bytes = vec![0u8; 20];
                bytes[0..4].copy_from_slice(&20u32.to_le_bytes());
                bytes[16..20].copy_from_slice(&1u32.to_le_bytes());
                for file in files {
                    for unit in file.encode_utf16() {
                        bytes.extend_from_slice(&unit.to_le_bytes())
                    }
                    bytes.extend_from_slice(&[0, 0]);
                }
                bytes.extend_from_slice(&[0, 0]);
                if set_windows_format(15, &bytes) {
                    written += 1
                }
            }
            CapturedPayload::Binary(bytes) => {
                let native = rep
                    .native_type
                    .as_deref()
                    .filter(|name| writeback_allowed(name))
                    .or(match rep.canonical_mime_type.as_deref() {
                        Some("image/png") => Some("PNG"),
                        Some("application/pdf") => Some("Portable Document Format"),
                        Some("image/svg+xml") => Some("image/svg+xml"),
                        _ => None,
                    });
                if let Some(native) = native {
                    let format = register_windows_format(native);
                    if set_windows_format(format, bytes) {
                        written += 1
                    }
                }
            }
            _ => {}
        }
    }
    if written == 0 {
        bail!("no supported representation remained for reconstruction")
    }
    Ok(())
}
#[cfg(target_os = "windows")]
unsafe fn register_windows_format(name: &str) -> u32 {
    use windows::{core::PCWSTR, Win32::System::DataExchange::RegisterClipboardFormatW};
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    RegisterClipboardFormatW(PCWSTR::from_raw(wide.as_ptr()))
}
#[cfg(target_os = "windows")]
unsafe fn set_windows_format(format: u32, bytes: &[u8]) -> bool {
    use windows::Win32::{
        Foundation::HANDLE,
        System::{
            DataExchange::SetClipboardData,
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GHND},
        },
    };
    if format == 0 {
        return false;
    }
    let global = match GlobalAlloc(GHND, bytes.len()) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let ptr = GlobalLock(global);
    if ptr.is_null() {
        return false;
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.cast::<u8>(), bytes.len());
    let _ = GlobalUnlock(global);
    SetClipboardData(
        format,
        Some(std::mem::transmute::<
            windows::Win32::Foundation::HGLOBAL,
            HANDLE,
        >(global)),
    )
    .is_ok()
}
#[cfg(target_os = "windows")]
fn writeback_allowed(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(name, "PNG" | "Portable Document Format" | "image/svg+xml")
        || lower.contains("office")
        || lower.contains("object")
        || lower.contains("powerpoint")
        || lower.contains("excel")
        || lower.contains("word")
}
#[cfg(target_os = "windows")]
fn windows_html_wrapper(fragment: &str) -> String {
    let prefix="Version:1.0\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n";
    let start_marker = "<!--StartFragment-->";
    let end_marker = "<!--EndFragment-->";
    let body = format!("<html><body>{start_marker}{fragment}{end_marker}</body></html>");
    let start_html = prefix.len();
    let start_fragment = start_html + body.find(start_marker).unwrap() + start_marker.len();
    let end_fragment = start_html + body.find(end_marker).unwrap();
    let end_html = start_html + body.len();
    format!("Version:1.0\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n{body}")
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Changing {
        token: u64,
    }
    impl ClipboardAdapter for Changing {
        fn snapshot_token(&mut self) -> Result<u64> {
            self.token += 1;
            Ok(self.token)
        }
        fn capture_once(&mut self, t: u64) -> Result<CapturedSnapshot> {
            Ok(CapturedSnapshot {
                token: t,
                source_app_name: None,
                source_app_id: None,
                representations: vec![CapturedRepresentation {
                    format_key: "x".into(),
                    canonical_mime_type: None,
                    native_type: None,
                    platform: "windows".into(),
                    capture_priority: 0,
                    payload: CapturedPayload::Text("x".into()),
                }],
            })
        }
        fn write(&mut self, _: &[CapturedRepresentation]) -> Result<u64> {
            Ok(0)
        }
    }
    #[test]
    fn changed_snapshot_exhausts_retries() {
        assert!(capture_coherent(&mut Changing { token: 0 }).is_err());
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn html_wrapper_offsets_select_the_fragment() {
        let wrapped = windows_html_wrapper("<b>hello</b>");
        let bytes = wrapped.as_bytes();
        let field = |name: &str| {
            wrapped
                .lines()
                .find_map(|line| line.strip_prefix(name))
                .unwrap()
                .parse::<usize>()
                .unwrap()
        };
        let start = field("StartFragment:");
        let end = field("EndFragment:");
        assert_eq!(
            std::str::from_utf8(&bytes[start..end]).unwrap(),
            "<b>hello</b>"
        );
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn native_writeback_never_guesses_unknown_formats() {
        assert!(writeback_allowed("PowerPoint 16.0 Internal Slides"));
        assert!(!writeback_allowed("mystery-format"));
    }
}
