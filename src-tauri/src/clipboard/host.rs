//! Existing coherent capture and platform implementation host.
use super::capabilities::{
    self, CapturePolicy, ReaderCodec, UnreadablePolicy, WritePolicy, WriterCodec,
};
use crate::history::{
    capture_fingerprint, CapturedPayload, CapturedRepresentation, CapturedSnapshot,
    FormatObservation,
};
use anyhow::{bail, Context, Result};
use arboard::{Clipboard, ImageData};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

#[derive(Debug, Clone)]
struct SelfWrite {
    token: u64,
    fingerprint: String,
    expires_at: std::time::Instant,
}

static SELF_WRITES: OnceLock<Mutex<VecDeque<SelfWrite>>> = OnceLock::new();

fn self_writes() -> &'static Mutex<VecDeque<SelfWrite>> {
    SELF_WRITES.get_or_init(|| Mutex::new(VecDeque::new()))
}

/// Records the exact snapshot written by ClipsX. A platform change token alone is
/// not sufficient: other owners can advance or reuse observable token values.
pub fn remember_self_write(token: u64, representations: &[CapturedRepresentation]) {
    let now = std::time::Instant::now();
    let mut writes = self_writes().lock().expect("self-write ledger poisoned");
    writes.retain(|entry| entry.expires_at > now);
    writes.push_back(SelfWrite {
        token,
        fingerprint: capture_fingerprint(representations),
        expires_at: now + Duration::from_secs(10),
    });
    while writes.len() > 16 {
        writes.pop_front();
    }
}

/// Consumes a pending ClipsX write by its platform change token before capture.
/// This handles platform-generated clipboard wrappers that make a read-back
/// representation fingerprint differ from the representation set we wrote.
/// The token is one-shot and short-lived, so a later clipboard owner is still
/// captured normally.
pub fn consume_self_write_token(token: u64) -> bool {
    let now = std::time::Instant::now();
    let mut writes = self_writes().lock().expect("self-write ledger poisoned");
    writes.retain(|entry| entry.expires_at > now);
    let Some(index) = writes.iter().position(|entry| entry.token == token) else {
        return false;
    };
    writes.remove(index);
    true
}

/// Suppression deliberately compares both the platform token and the complete
/// representation fingerprint. This prevents an unrelated clipboard update from
/// being dropped merely because it follows a ClipsX write.
pub fn is_self_write_snapshot(snapshot: &CapturedSnapshot) -> bool {
    let now = std::time::Instant::now();
    let fingerprint = capture_fingerprint(&snapshot.representations);
    let mut writes = self_writes().lock().expect("self-write ledger poisoned");
    writes.retain(|entry| entry.expires_at > now);
    writes
        .iter()
        .any(|entry| entry.token == snapshot.token && entry.fingerprint == fingerprint)
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
        let mut observations = Vec::new();
        let source_app_name = active_app_name();
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
                let (format_key, native_type) = plain_text_identity();
                reps.push(CapturedRepresentation {
                    format_key: format_key.into(),
                    canonical_mime_type: Some("text/plain".into()),
                    native_type: Some(native_type.into()),
                    platform: platform_name().into(),
                    capture_priority: 100,
                    payload: CapturedPayload::Text(text),
                });
                if cfg!(not(target_os = "windows")) {
                    observations.push(format_observation(
                        observations.len(),
                        platform_name(),
                        native_type,
                        None,
                        None,
                        Some(format_key.trim_start_matches(&format!("{}:", platform_name()))),
                        "captured",
                        "normalized_text",
                    ));
                }
            }
        }
        #[cfg(target_os = "windows")]
        unsafe {
            capture_windows_formats(&mut reps, &mut observations, source_app_name.as_deref())?;
        }
        #[cfg(target_os = "macos")]
        unsafe {
            capture_macos_formats(&mut reps, &mut observations)?;
        }
        #[cfg(target_os = "linux")]
        capture_x11_formats(&mut reps, &mut observations)?;
        let has_native_image = reps.iter().any(|representation| {
            representation
                .canonical_mime_type
                .as_deref()
                .is_some_and(|mime| matches!(mime, "image/png" | "image/jpeg" | "image/tiff"))
        });
        if !has_native_image {
            if let Ok(image) = clipboard.get_image() {
                let (format_key, native_type) = normalized_image_identity();
                reps.push(CapturedRepresentation {
                    format_key,
                    canonical_mime_type: Some("image/png".into()),
                    native_type: native_type.clone(),
                    platform: platform_name().into(),
                    capture_priority: 200,
                    payload: CapturedPayload::Binary(encode_png(image)?),
                });
                let capability = native_type
                    .as_deref()
                    .and_then(|native| capabilities::resolve(platform_name(), None, native));
                observations.push(format_observation(
                    observations.len(),
                    platform_name(),
                    native_type.as_deref().unwrap_or("normalized:image/png"),
                    None,
                    None,
                    capability.map(|value| value.id.as_str()),
                    "captured",
                    "normalized_image",
                ));
            }
        }
        deduplicate_representation_formats(&mut reps);
        if reps.is_empty() {
            bail!("clipboard has no supported representations")
        }
        self.fallback_token = self.fallback_token.wrapping_add(1);
        Ok(CapturedSnapshot {
            token,
            source_app_name,
            source_app_id: None,
            format_observations: observations,
            representations: reps,
        })
    }
    fn write(&mut self, reps: &[CapturedRepresentation]) -> Result<u64> {
        #[cfg(target_os = "windows")]
        unsafe {
            write_windows_formats(reps)?;
            let token = self.snapshot_token()?;
            remember_self_write(token, reps);
            Ok(token)
        }
        #[cfg(target_os = "macos")]
        unsafe {
            write_macos_formats(reps)?;
            let token = self.snapshot_token()?;
            remember_self_write(token, reps);
            Ok(token)
        }
        #[cfg(target_os = "linux")]
        {
            // arboard can only own one payload at a time on X11. Own the
            // CLIPBOARD selection ourselves so TARGETS can expose the complete
            // v2 representation set to the receiving application.
            x11_own_selection(reps.to_vec())?;
            let token = self.snapshot_token()?;
            remember_self_write(token, reps);
            Ok(token)
        }
    }
}

/// Builds the one platform-supported plain-text representation used by host
/// output commands. Native clipboard identity remains owned by this adapter.
pub fn plain_text_representation(text: String) -> CapturedRepresentation {
    let (format_key, native_type) = plain_text_identity();
    CapturedRepresentation {
        format_key: format_key.into(),
        canonical_mime_type: Some("text/plain".into()),
        native_type: Some(native_type.into()),
        platform: platform_name().into(),
        capture_priority: 0,
        payload: CapturedPayload::Text(text),
    }
}

#[allow(clippy::too_many_arguments)]
fn format_observation(
    ordinal: usize,
    platform: &str,
    identifier: &str,
    numeric_id: Option<u32>,
    byte_length: Option<usize>,
    capability_id: Option<&str>,
    decision: &str,
    reason: &str,
) -> FormatObservation {
    FormatObservation {
        ordinal: ordinal as i64,
        platform: platform.into(),
        native_identifier: identifier.chars().take(256).collect(),
        numeric_id: numeric_id.map(i64::from),
        medium: None,
        byte_length: byte_length.and_then(|value| i64::try_from(value).ok()),
        capability_id: capability_id.map(str::to_string),
        policy_version: capabilities::matrix().version as i64,
        decision: decision.into(),
        reason: reason.into(),
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
fn plain_text_identity() -> (&'static str, &'static str) {
    if cfg!(target_os = "macos") {
        ("macos:public.utf8-plain-text", "public.utf8-plain-text")
    } else if cfg!(target_os = "windows") {
        ("windows:CF_UNICODETEXT", "CF_UNICODETEXT")
    } else {
        ("linux_x11:UTF8_STRING", "UTF8_STRING")
    }
}
fn deduplicate_representation_formats(representations: &mut Vec<CapturedRepresentation>) {
    let mut deduplicated: Vec<CapturedRepresentation> = Vec::with_capacity(representations.len());
    for representation in representations.drain(..) {
        if let Some(existing) = deduplicated
            .iter_mut()
            .find(|existing| existing.format_key == representation.format_key)
        {
            if representation.capture_priority < existing.capture_priority {
                *existing = representation;
            }
        } else {
            deduplicated.push(representation);
        }
    }
    *representations = deduplicated;
}

fn ordered_write_representations<'a>(
    representations: &'a [CapturedRepresentation],
    platform: &str,
) -> Vec<&'a CapturedRepresentation> {
    let mut ordered: Vec<_> = representations.iter().collect();
    ordered.sort_by_key(|representation| {
        representation
            .native_type
            .as_deref()
            .and_then(|native| capabilities::resolve(platform, None, native))
            .map_or(representation.capture_priority, |capability| {
                capability.write_back.priority
            })
    });
    ordered
}
#[cfg(target_os = "windows")]
fn normalized_image_identity() -> (String, Option<String>) {
    use windows::Win32::System::DataExchange::IsClipboardFormatAvailable;
    let (png, dib_v5, dib) = unsafe {
        (
            IsClipboardFormatAvailable(register_windows_format("PNG")).is_ok(),
            IsClipboardFormatAvailable(17).is_ok(),
            IsClipboardFormatAvailable(8).is_ok(),
        )
    };
    windows_normalized_image_identity_for(png, dib_v5, dib)
}
#[cfg(target_os = "windows")]
fn windows_normalized_image_identity_for(
    png: bool,
    dib_v5: bool,
    dib: bool,
) -> (String, Option<String>) {
    let native = if png {
        Some("PNG")
    } else if dib_v5 {
        Some("CF_DIBV5")
    } else if dib {
        Some("CF_DIB")
    } else {
        None
    };
    (
        native.map_or_else(
            || "windows:normalized:image/png".into(),
            |native| format!("windows:{native}"),
        ),
        native.map(str::to_string),
    )
}
#[cfg(target_os = "macos")]
fn normalized_image_identity() -> (String, Option<String>) {
    ("macos:normalized:image/png".into(), None)
}
#[cfg(target_os = "linux")]
fn normalized_image_identity() -> (String, Option<String>) {
    ("linux_x11:normalized:image/png".into(), None)
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
    for rep in ordered_write_representations(reps, "macos") {
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
        let allowed = capabilities::resolve("macos", None, native)
            .is_some_and(|capability| capability.write_back.policy != WritePolicy::Unsupported);
        if !allowed {
            continue;
        }
        let ty: id = NSString::alloc(nil).init_str(native);
        if let CapturedPayload::Files(files) = &rep.payload {
            let urls: id = msg_send![class!(NSMutableArray), arrayWithCapacity:files.len()];
            for file in files {
                let value = NSString::alloc(nil).init_str(file);
                let url: id = if file.starts_with("file://") {
                    msg_send![class!(NSURL), URLWithString:value]
                } else {
                    msg_send![class!(NSURL), fileURLWithPath:value]
                };
                if url != nil {
                    let _: () = msg_send![urls, addObject:url];
                }
            }
            let success: bool = msg_send![pb, writeObjects:urls];
            if success {
                written += 1;
            }
            continue;
        }
        let bytes = match &rep.payload {
            CapturedPayload::Text(value) => value.as_bytes(),
            CapturedPayload::Binary(value) => value.as_slice(),
            CapturedPayload::Files(_) => unreachable!(),
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
unsafe fn capture_macos_formats(
    reps: &mut Vec<CapturedRepresentation>,
    observations: &mut Vec<FormatObservation>,
) -> Result<()> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
    let url_classes: id = msg_send![class!(NSArray), arrayWithObject:class!(NSURL)];
    let urls: id = msg_send![pb, readObjectsForClasses:url_classes options:nil];
    if urls != nil {
        let count: usize = msg_send![urls, count];
        let mut files = Vec::with_capacity(count);
        for index in 0..count {
            let url: id = msg_send![urls, objectAtIndex:index];
            let is_file: bool = msg_send![url, isFileURL];
            if !is_file {
                continue;
            }
            let path: id = msg_send![url, path];
            if path == nil {
                continue;
            }
            let ptr: *const std::ffi::c_char = msg_send![path, UTF8String];
            if !ptr.is_null() {
                files.push(std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned());
            }
        }
        if !files.is_empty() {
            reps.push(CapturedRepresentation {
                format_key: "macos:public.file-url".into(),
                canonical_mime_type: None,
                native_type: Some("public.file-url".into()),
                platform: "macos".into(),
                capture_priority: 10,
                payload: CapturedPayload::Files(files),
            });
            observations.push(format_observation(
                observations.len(),
                "macos",
                "public.file-url",
                None,
                None,
                Some("macos.files.urls"),
                "captured",
                "ordered_file_references",
            ));
        }
    }
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
        if name == "public.file-url" {
            continue;
        }
        let Some(capability) = capabilities::resolve("macos", None, &name) else {
            observations.push(format_observation(
                observations.len(),
                "macos",
                &name,
                None,
                None,
                None,
                "unsupported",
                "no_matching_capability",
            ));
            continue;
        };
        if matches!(
            capability.capture,
            CapturePolicy::DiagnosticOnly | CapturePolicy::Redundant
        ) {
            observations.push(format_observation(
                observations.len(),
                "macos",
                &name,
                None,
                None,
                Some(&capability.id),
                "unsupported",
                "diagnostic_only",
            ));
            continue;
        }
        let data: id = msg_send![pb,dataForType:ty];
        if data == nil {
            observations.push(format_observation(
                observations.len(),
                "macos",
                &name,
                None,
                None,
                Some(&capability.id),
                "unreadable",
                "pasteboard_data_unavailable",
            ));
            if capability.unreadable == UnreadablePolicy::RejectSnapshot {
                bail!("supported macOS pasteboard type {name} was unreadable")
            }
            continue;
        }
        let length: usize = msg_send![data, length];
        let bytes_ptr: *const u8 = msg_send![data, bytes];
        if bytes_ptr.is_null() && length != 0 {
            continue;
        }
        let bytes = if length == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(bytes_ptr, length).to_vec()
        };
        let representation = capability
            .representation
            .as_ref()
            .context("captured macOS capability has no representation")?;
        let payload = if representation.storage_kind == "text" {
            CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned())
        } else {
            CapturedPayload::Binary(bytes)
        };
        reps.push(CapturedRepresentation {
            format_key: format!("macos:{name}"),
            canonical_mime_type: representation.mime_type.clone(),
            native_type: Some(name.clone()),
            platform: "macos".into(),
            capture_priority: representation.priority,
            payload,
        });
        observations.push(format_observation(
            observations.len(),
            "macos",
            &name,
            None,
            Some(length),
            Some(&capability.id),
            "captured",
            if capability.bundle.is_some() {
                "captured_office_bundle_member"
            } else {
                "matched_capability"
            },
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn x11_owner_token() -> Result<u64> {
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{AtomEnum, ConnectionExt, CreateWindowAux, WindowClass},
            Event,
        },
        COPY_DEPTH_FROM_PARENT, CURRENT_TIME,
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

/// Own CLIPBOARD in a dedicated thread and answer selection requests for every
/// explicitly supported representation. The owner intentionally exits when a
/// subsequent clipboard owner replaces it, keeping no stale background state.
#[cfg(target_os = "linux")]
fn x11_own_selection(representations: Vec<CapturedRepresentation>) -> Result<()> {
    use std::sync::mpsc;
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        x11_selection_loop(representations, ready_tx);
    });
    ready_rx
        .recv_timeout(Duration::from_millis(250))
        .map_err(|_| anyhow::anyhow!("X11 selection owner did not become ready"))?
        .map_err(anyhow::Error::msg)
}

#[cfg(target_os = "linux")]
fn x11_selection_loop(
    representations: Vec<CapturedRepresentation>,
    ready_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) {
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{
                AtomEnum, ConnectionExt, CreateWindowAux, EventMask, PropMode,
                SelectionNotifyEvent, WindowClass,
            },
            Event,
        },
        COPY_DEPTH_FROM_PARENT, CURRENT_TIME,
    };
    let run = || -> Result<()> {
        let (conn, screen_index) = x11rb::connect(None)?;
        let atom =
            |name: &[u8]| -> Result<u32> { Ok(conn.intern_atom(false, name)?.reply()?.atom) };
        let clipboard = atom(b"CLIPBOARD")?;
        let targets = atom(b"TARGETS")?;
        let timestamp = atom(b"TIMESTAMP")?;
        let utf8 = atom(b"UTF8_STRING")?;
        let atom_atom = AtomEnum::ATOM.into();
        let integer = AtomEnum::INTEGER.into();
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
            &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )?
        .check()?;
        conn.set_selection_owner(window, clipboard, CURRENT_TIME)?
            .check()?;
        conn.flush()?;

        let mut values: std::collections::BTreeMap<u32, Vec<u8>> = Default::default();
        let mut offered = vec![targets, timestamp];
        for representation in &representations {
            let target_name = representation
                .native_type
                .as_deref()
                .or(representation.canonical_mime_type.as_deref())
                .unwrap_or_default();
            let target_name = match target_name {
                "text/plain;charset=utf-8" => "text/plain",
                other => other,
            };
            if target_name.is_empty() || !x11_writeback_allowed(target_name) {
                continue;
            }
            let value = match &representation.payload {
                CapturedPayload::Text(text) => text.as_bytes().to_vec(),
                CapturedPayload::Binary(bytes) => bytes.clone(),
                CapturedPayload::Files(files) => {
                    let mut text = files.join("\r\n");
                    text.push_str("\r\n");
                    text.into_bytes()
                }
            };
            let target = atom(target_name.as_bytes())?;
            if values.insert(target, value).is_none() {
                offered.push(target);
            }
            if target_name == "text/plain" && values.get(&utf8).is_none() {
                values.insert(utf8, values[&target].clone());
                offered.push(utf8);
            }
        }
        if values.is_empty() {
            bail!("no X11 writeable representation is available")
        }

        // Signal ownership acquired; the caller can now proceed. The loop
        // below continues serving requests on this background thread until
        // another owner replaces us (SelectionClear).
        let _ = ready_tx.send(Ok(()));

        loop {
            match conn.wait_for_event()? {
                Event::SelectionClear(event) if event.selection == clipboard => break,
                Event::SelectionRequest(request) if request.selection == clipboard => {
                    let property = if request.property == AtomEnum::NONE.into() {
                        request.target
                    } else {
                        request.property
                    };
                    let mut accepted = true;
                    if request.target == targets {
                        conn.change_property32(
                            PropMode::REPLACE,
                            request.requestor,
                            property,
                            atom_atom,
                            &offered,
                        )?
                        .check()?;
                    } else if request.target == timestamp {
                        conn.change_property32(
                            PropMode::REPLACE,
                            request.requestor,
                            property,
                            integer,
                            &[CURRENT_TIME],
                        )?
                        .check()?;
                    } else if let Some(value) = values.get(&request.target) {
                        conn.change_property8(
                            PropMode::REPLACE,
                            request.requestor,
                            property,
                            request.target,
                            value,
                        )?
                        .check()?;
                    } else {
                        accepted = false;
                    }
                    let response = SelectionNotifyEvent {
                        response_type: 31,
                        sequence: 0,
                        time: request.time,
                        requestor: request.requestor,
                        selection: request.selection,
                        target: request.target,
                        property: if accepted {
                            property
                        } else {
                            AtomEnum::NONE.into()
                        },
                    };
                    conn.send_event(false, request.requestor, EventMask::NO_EVENT, response)?
                        .check()?;
                    conn.flush()?;
                }
                _ => {}
            }
        }
        let _ = conn.destroy_window(window);
        let _ = conn.flush();
        Ok(())
    };
    // If setup fails before we signal ready, unblock the caller with the error.
    if let Err(error) = run() {
        let _ = ready_tx.send(Err(error.to_string()));
    }
}

#[cfg(target_os = "linux")]
fn x11_writeback_allowed(target: &str) -> bool {
    matches!(
        target,
        "text/plain"
            | "UTF8_STRING"
            | "text/html"
            | "text/rtf"
            | "application/rtf"
            | "text/uri-list"
            | "image/png"
    )
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
fn capture_x11_formats(
    reps: &mut Vec<CapturedRepresentation>,
    observations: &mut Vec<FormatObservation>,
) -> Result<()> {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{ConnectionExt, CreateWindowAux, EventMask, WindowClass},
        COPY_DEPTH_FROM_PARENT,
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
        let Some(capability) = capabilities::resolve("linux_x11", None, &name) else {
            observations.push(format_observation(
                observations.len(),
                "linux_x11",
                &name,
                Some(atom),
                None,
                None,
                "unsupported",
                "no_matching_capability",
            ));
            continue;
        };
        let (_, bytes) = match x11_read_target(&conn, window, selection, atom, property) {
            Ok(value) => value,
            Err(error) if capability.unreadable == UnreadablePolicy::RejectSnapshot => {
                return Err(error)
            }
            Err(_) => {
                observations.push(format_observation(
                    observations.len(),
                    "linux_x11",
                    &name,
                    Some(atom),
                    None,
                    Some(&capability.id),
                    "unreadable",
                    "selection_target_unavailable",
                ));
                continue;
            }
        };
        if bytes.is_empty() {
            continue;
        }
        let representation = capability
            .representation
            .as_ref()
            .context("captured X11 capability has no representation")?;
        let byte_length = bytes.len();
        let payload = match representation.storage_kind.as_str() {
            "text" => CapturedPayload::Text(String::from_utf8_lossy(&bytes).into_owned()),
            "file_list" => CapturedPayload::Files(
                String::from_utf8_lossy(&bytes)
                    .lines()
                    .map(str::trim)
                    .filter(|v| !v.is_empty() && !v.starts_with('#'))
                    .map(str::to_string)
                    .collect(),
            ),
            _ => CapturedPayload::Binary(bytes),
        };
        reps.push(CapturedRepresentation {
            format_key: format!("linux_x11:{name}"),
            canonical_mime_type: representation.mime_type.clone(),
            native_type: Some(name.clone()),
            platform: "linux_x11".into(),
            capture_priority: representation.priority,
            payload,
        });
        observations.push(format_observation(
            observations.len(),
            "linux_x11",
            &name,
            Some(atom),
            Some(byte_length),
            Some(&capability.id),
            "captured",
            "matched_capability",
        ));
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
            xproto::{AtomEnum, ConnectionExt},
            Event,
        },
        CURRENT_TIME,
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
unsafe fn capture_windows_formats(
    reps: &mut Vec<CapturedRepresentation>,
    observations: &mut Vec<FormatObservation>,
    source_app: Option<&str>,
) -> Result<()> {
    use windows::Win32::{
        Foundation::HGLOBAL,
        System::{
            DataExchange::{
                CloseClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardFormatNameW,
                IsClipboardFormatAvailable, OpenClipboard,
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
    if IsClipboardFormatAvailable(13).is_ok() {
        observations.push(format_observation(
            observations.len(),
            "windows",
            "CF_UNICODETEXT",
            Some(13),
            None,
            Some("windows.text.unicode"),
            "captured",
            "normalized_text",
        ));
    }
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
                canonical_mime_type: None,
                native_type: Some("CF_HDROP".into()),
                platform: "windows".into(),
                capture_priority: 5,
                payload: CapturedPayload::Files(files),
            });
            observations.push(format_observation(
                observations.len(),
                "windows",
                "CF_HDROP",
                Some(15),
                None,
                Some("windows.files.hdrop"),
                "captured",
                "ordered_file_references",
            ));
        }
    }
    for (id, name, capability_id) in [
        (17, "CF_DIBV5", "windows.image.dibv5"),
        (8, "CF_DIB", "windows.image.dib"),
    ] {
        if IsClipboardFormatAvailable(id).is_ok() {
            observations.push(format_observation(
                observations.len(),
                "windows",
                name,
                Some(id),
                None,
                Some(capability_id),
                "captured",
                "normalized_by_image_adapter",
            ));
        }
    }
    let mut office_candidates: Vec<(&'static capabilities::Capability, String, Vec<u8>, u32)> =
        Vec::new();
    let mut format = 0u32;
    loop {
        format = EnumClipboardFormats(format);
        if format == 0 {
            break;
        }
        let mut name_buf = [0u16; 256];
        let len = GetClipboardFormatNameW(format, &mut name_buf);
        if len == 0 && matches!(format, 8 | 13 | 15 | 17) {
            continue;
        }
        let name = if len == 0 {
            windows_standard_format_name(format)
                .map_or_else(|| format!("CF_FORMAT_{format}"), str::to_string)
        } else {
            String::from_utf16_lossy(&name_buf[..len as usize])
        };
        let Some(capability) = capabilities::resolve("windows", Some(format), &name) else {
            observations.push(format_observation(
                observations.len(),
                "windows",
                &name,
                Some(format),
                None,
                None,
                "unsupported",
                "no_matching_capability",
            ));
            continue;
        };
        if matches!(
            capability.capture,
            CapturePolicy::DiagnosticOnly | CapturePolicy::Redundant
        ) {
            let (decision, reason) = if capability.capture == CapturePolicy::Redundant {
                ("redundant", "superseded_by_canonical_format")
            } else {
                ("unsupported", "diagnostic_only")
            };
            observations.push(format_observation(
                observations.len(),
                "windows",
                &name,
                Some(format),
                None,
                Some(&capability.id),
                decision,
                reason,
            ));
            continue;
        }
        let handle = match GetClipboardData(format) {
            Ok(v) => v,
            Err(error) => {
                observations.push(format_observation(
                    observations.len(),
                    "windows",
                    &name,
                    Some(format),
                    None,
                    Some(&capability.id),
                    "unreadable",
                    "get_clipboard_data_failed",
                ));
                if capability.unreadable == UnreadablePolicy::RejectSnapshot {
                    return Err(error.into());
                }
                continue;
            }
        };
        let global = std::mem::transmute::<windows::Win32::Foundation::HANDLE, HGLOBAL>(handle);
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            observations.push(format_observation(
                observations.len(),
                "windows",
                &name,
                Some(format),
                None,
                Some(&capability.id),
                "unreadable",
                "global_lock_failed",
            ));
            if capability.unreadable == UnreadablePolicy::RejectSnapshot {
                bail!("supported Windows clipboard format {name} was unreadable")
            }
            continue;
        }
        let size = GlobalSize(global);
        let bytes = std::slice::from_raw_parts(ptr.cast::<u8>(), size).to_vec();
        let _ = GlobalUnlock(global);
        let trimmed = &bytes[..bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len())];
        if capability.family == "office" {
            office_candidates.push((capability, name, bytes, format));
            continue;
        }
        let representation = capability
            .representation
            .as_ref()
            .context("captured capability has no representation")?;
        let payload = match capability.reader {
            Some(ReaderCodec::WindowsHtml) => CapturedPayload::Text(parse_windows_html(trimmed)),
            Some(ReaderCodec::WindowsRtf) => {
                CapturedPayload::Text(String::from_utf8_lossy(trimmed).into_owned())
            }
            _ => CapturedPayload::Binary(bytes),
        };
        let byte_length = match &payload {
            CapturedPayload::Text(v) => v.len(),
            CapturedPayload::Binary(v) => v.len(),
            CapturedPayload::Files(v) => v.iter().map(String::len).sum(),
        };
        reps.push(CapturedRepresentation {
            format_key: format!("windows:{name}"),
            canonical_mime_type: representation.mime_type.clone(),
            native_type: Some(name.clone()),
            platform: "windows".into(),
            capture_priority: representation.priority,
            payload,
        });
        observations.push(format_observation(
            observations.len(),
            "windows",
            &name,
            Some(format),
            Some(byte_length),
            Some(&capability.id),
            "captured",
            "matched_capability",
        ));
    }
    if !office_candidates.is_empty() {
        office_candidates.sort_by(|left, right| {
            let left_priority = left
                .0
                .representation
                .as_ref()
                .map_or(i64::MAX, |value| value.priority);
            let right_priority = right
                .0
                .representation
                .as_ref()
                .map_or(i64::MAX, |value| value.priority);
            left_priority
                .cmp(&right_priority)
                .then_with(|| right.2.len().cmp(&left.2.len()))
                .then_with(|| left.1.cmp(&right.1))
        });
        let (selected, selected_name, selected_bytes, selected_format) =
            office_candidates.remove(0);
        let representation = selected
            .representation
            .as_ref()
            .context("Office capability has no representation")?;
        reps.push(CapturedRepresentation {
            format_key: format!("windows:{selected_name}"),
            canonical_mime_type: representation.mime_type.clone(),
            native_type: Some(selected_name.clone()),
            platform: "windows".into(),
            capture_priority: representation.priority,
            payload: CapturedPayload::Binary(selected_bytes.clone()),
        });
        observations.push(format_observation(
            observations.len(),
            "windows",
            &selected_name,
            Some(selected_format),
            Some(selected_bytes.len()),
            Some(&selected.id),
            "captured",
            if source_app.is_some() {
                "selected_office_primary"
            } else {
                "selected_office_primary_without_source_hint"
            },
        ));
        for (candidate, name, bytes, format) in office_candidates {
            observations.push(format_observation(
                observations.len(),
                "windows",
                &name,
                Some(format),
                Some(bytes.len()),
                Some(&candidate.id),
                "redundant",
                "office_candidate_not_selected",
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_standard_format_name(format: u32) -> Option<&'static str> {
    Some(match format {
        1 => "CF_TEXT",
        2 => "CF_BITMAP",
        3 => "CF_METAFILEPICT",
        4 => "CF_SYLK",
        5 => "CF_DIF",
        6 => "CF_TIFF",
        7 => "CF_OEMTEXT",
        8 => "CF_DIB",
        9 => "CF_PALETTE",
        10 => "CF_PENDATA",
        11 => "CF_RIFF",
        12 => "CF_WAVE",
        13 => "CF_UNICODETEXT",
        14 => "CF_ENHMETAFILE",
        15 => "CF_HDROP",
        16 => "CF_LOCALE",
        17 => "CF_DIBV5",
        _ => return None,
    })
}
#[cfg(target_os = "windows")]
fn parse_windows_html(bytes: &[u8]) -> String {
    let raw = String::from_utf8_lossy(bytes);
    let mut start_html = None;
    let mut end_html = None;
    let mut start_fragment = None;
    let mut end_fragment = None;
    for line in raw.lines().take(15) {
        if let Some(v) = line.strip_prefix("StartHTML:") {
            start_html = v.trim().parse().ok()
        }
        if let Some(v) = line.strip_prefix("EndHTML:") {
            end_html = v.trim().parse().ok()
        }
        if let Some(v) = line.strip_prefix("StartFragment:") {
            start_fragment = v.trim().parse().ok()
        }
        if let Some(v) = line.strip_prefix("EndFragment:") {
            end_fragment = v.trim().parse().ok()
        }
    }
    start_fragment
        .zip(end_fragment)
        .or_else(|| start_html.zip(end_html))
        .and_then(|(start, end)| raw.get(start..end))
        .unwrap_or(&raw)
        .to_string()
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
    for rep in ordered_write_representations(reps, "windows") {
        match &rep.payload {
            CapturedPayload::Text(value)
                if rep.canonical_mime_type.as_deref() == Some("text/plain") =>
            {
                let bytes = windows_unicode_text_bytes(value);
                if set_windows_format(13, &bytes) {
                    written += 1
                }
            }
            CapturedPayload::Text(value)
                if rep.canonical_mime_type.as_deref() == Some("text/html") =>
            {
                let wrapped = windows_html_wrapper(value);
                let format = register_windows_format("HTML Format");
                if set_windows_format(format, &windows_registered_text_bytes(&wrapped)) {
                    written += 1
                }
            }
            CapturedPayload::Text(value)
                if rep.canonical_mime_type.as_deref() == Some("text/rtf") =>
            {
                let format = register_windows_format("Rich Text Format");
                if set_windows_format(format, &windows_registered_text_bytes(value)) {
                    written += 1
                }
            }
            CapturedPayload::Files(files) => {
                let bytes = windows_hdrop_bytes(files);
                if set_windows_format(15, &bytes) {
                    written += 1
                }
            }
            CapturedPayload::Binary(bytes) => {
                let native = rep.native_type.as_deref();
                let capability = native
                    .filter(|name| writeback_allowed(name))
                    .and_then(|name| capabilities::resolve("windows", None, name));
                let target = match capability.and_then(|value| value.write_back.writer) {
                    Some(WriterCodec::WindowsPng) => Some("PNG"),
                    Some(WriterCodec::WindowsRegisteredBytes) => native,
                    _ => match rep.canonical_mime_type.as_deref() {
                        Some("image/png") => Some("PNG"),
                        Some("application/pdf") => Some("Portable Document Format"),
                        Some("image/svg+xml") => Some("image/svg+xml"),
                        _ => None,
                    },
                };
                if let Some(native) = target {
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
fn windows_unicode_text_bytes(value: &str) -> Vec<u8> {
    value
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}
#[cfg(target_os = "windows")]
fn windows_registered_text_bytes(value: &str) -> Vec<u8> {
    let mut bytes = value.as_bytes().to_vec();
    bytes.push(0);
    bytes
}
#[cfg(target_os = "windows")]
fn windows_hdrop_bytes(files: &[String]) -> Vec<u8> {
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
    bytes
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
    capabilities::resolve("windows", None, name)
        .is_some_and(|capability| capability.write_back.policy != WritePolicy::Unsupported)
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
                format_observations: Vec::new(),
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
    #[test]
    fn self_write_requires_matching_token_and_fingerprint() {
        let representations = vec![CapturedRepresentation {
            format_key: "windows:text/plain".into(),
            canonical_mime_type: Some("text/plain".into()),
            native_type: None,
            platform: "windows".into(),
            capture_priority: 1,
            payload: CapturedPayload::Text("expected".into()),
        }];
        remember_self_write(42, &representations);
        let matching = CapturedSnapshot {
            token: 42,
            source_app_name: None,
            source_app_id: None,
            representations: representations.clone(),
            format_observations: Vec::new(),
        };
        assert!(is_self_write_snapshot(&matching));
        let changed = CapturedSnapshot {
            token: 42,
            source_app_name: None,
            source_app_id: None,
            format_observations: Vec::new(),
            representations: vec![CapturedRepresentation {
                payload: CapturedPayload::Text("other".into()),
                ..representations[0].clone()
            }],
        };
        assert!(!is_self_write_snapshot(&changed));
    }
    #[test]
    fn self_write_token_is_consumed_once_before_readback() {
        let representations = vec![CapturedRepresentation {
            format_key: "windows:text/plain".into(),
            canonical_mime_type: Some("text/plain".into()),
            native_type: None,
            platform: "windows".into(),
            capture_priority: 1,
            payload: CapturedPayload::Text("expected".into()),
        }];
        remember_self_write(43, &representations);
        assert!(consume_self_write_token(43));
        assert!(!consume_self_write_token(43));
    }
    #[test]
    fn plain_text_identity_matches_platform_matrix() {
        let (format_key, native_type) = plain_text_identity();
        if cfg!(target_os = "windows") {
            assert_eq!(
                (format_key, native_type),
                ("windows:CF_UNICODETEXT", "CF_UNICODETEXT")
            );
        } else if cfg!(target_os = "macos") {
            assert_eq!(
                (format_key, native_type),
                ("macos:public.utf8-plain-text", "public.utf8-plain-text")
            );
        } else {
            assert_eq!(
                (format_key, native_type),
                ("linux_x11:UTF8_STRING", "UTF8_STRING")
            );
        }
    }
    #[test]
    fn duplicate_native_formats_keep_the_highest_capture_priority() {
        let mut representations = vec![
            CapturedRepresentation {
                format_key: "macos:public.utf8-plain-text".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("public.utf8-plain-text".into()),
                platform: "macos".into(),
                capture_priority: 100,
                payload: CapturedPayload::Text("generic".into()),
            },
            CapturedRepresentation {
                format_key: "macos:public.utf8-plain-text".into(),
                canonical_mime_type: Some("text/plain".into()),
                native_type: Some("public.utf8-plain-text".into()),
                platform: "macos".into(),
                capture_priority: 20,
                payload: CapturedPayload::Text("native".into()),
            },
        ];
        deduplicate_representation_formats(&mut representations);
        assert_eq!(representations.len(), 1);
        assert_eq!(representations[0].capture_priority, 20);
        assert!(matches!(
            &representations[0].payload,
            CapturedPayload::Text(value) if value == "native"
        ));
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn html_wrapper_offsets_select_the_fragment() {
        let fragment = "<b>hello 雪</b>";
        let wrapped = windows_html_wrapper(fragment);
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
        assert_eq!(std::str::from_utf8(&bytes[start..end]).unwrap(), fragment);
        assert_eq!(parse_windows_html(bytes), fragment);
        assert_eq!(parse_windows_html(fragment.as_bytes()), fragment);
        let terminated = windows_registered_text_bytes(&wrapped);
        assert_eq!(terminated.last(), Some(&0));
        assert_eq!(
            parse_windows_html(&terminated[..terminated.len() - 1]),
            fragment
        );
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_text_and_file_list_codecs_preserve_unicode_and_order() {
        let text = windows_unicode_text_bytes("hello 雪");
        let units: Vec<u16> = text
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        assert_eq!(
            String::from_utf16(&units[..units.len() - 1]).unwrap(),
            "hello 雪"
        );
        assert_eq!(units.last(), Some(&0));

        let files = vec![
            r"C:\first\雪.txt".to_string(),
            r"D:\second\report.rtf".to_string(),
        ];
        let encoded = windows_hdrop_bytes(&files);
        assert_eq!(u32::from_le_bytes(encoded[0..4].try_into().unwrap()), 20);
        assert_eq!(u32::from_le_bytes(encoded[16..20].try_into().unwrap()), 1);
        let units: Vec<u16> = encoded[20..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let decoded: Vec<String> = units
            .split(|unit| *unit == 0)
            .take_while(|value| !value.is_empty())
            .map(|value| String::from_utf16(value).unwrap())
            .collect();
        assert_eq!(decoded, files);
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn normalized_windows_images_keep_observed_identity_without_guessing() {
        assert_eq!(
            windows_normalized_image_identity_for(true, true, true),
            ("windows:PNG".into(), Some("PNG".into()))
        );
        assert_eq!(
            windows_normalized_image_identity_for(false, true, true),
            ("windows:CF_DIBV5".into(), Some("CF_DIBV5".into()))
        );
        assert_eq!(
            windows_normalized_image_identity_for(false, false, true),
            ("windows:CF_DIB".into(), Some("CF_DIB".into()))
        );
        assert_eq!(
            windows_normalized_image_identity_for(false, false, false),
            ("windows:normalized:image/png".into(), None)
        );
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn native_writeback_never_guesses_unknown_formats() {
        assert!(writeback_allowed("PowerPoint 16.0 Slides Package"));
        assert!(!writeback_allowed("PowerPoint 16.0 Internal Slides"));
        assert!(!writeback_allowed("mystery-format"));
    }
}
