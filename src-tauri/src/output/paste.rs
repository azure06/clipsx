//! Platform paste simulation. Clipboard writes happen before this module is
//! invoked, so a simulation failure leaves the copied result available.
use anyhow::Result;

/// Opaque target representing the focused application before ClipsX hid itself.
/// Capture this before hiding the window; pass it to [`simulate_paste`].
#[derive(Debug, Clone, Copy)]
pub struct FocusTarget(PlatformTarget);

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
struct PlatformTarget(isize);

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy)]
struct PlatformTarget(i32); // pid_t

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy)]
struct PlatformTarget(u32); // X11 Window XID

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
#[derive(Debug, Clone, Copy)]
struct PlatformTarget(());

/// Capture the currently focused application. Call this before hiding the
/// ClipsX window so the target is the application that requested paste.
pub fn capture_focus() -> Option<FocusTarget> {
    platform_capture_focus().map(FocusTarget)
}

#[cfg(target_os = "windows")]
fn platform_capture_focus() -> Option<PlatformTarget> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        None
    } else {
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
        if process_id == std::process::id() {
            return None;
        }
        Some(PlatformTarget(hwnd.0 as isize))
    }
}

#[cfg(target_os = "macos")]
fn platform_capture_focus() -> Option<PlatformTarget> {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: id = msg_send![workspace, frontmostApplication];
        if app == cocoa::base::nil {
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        if pid <= 0 || pid as u32 == std::process::id() {
            None
        } else {
            Some(PlatformTarget(pid))
        }
    }
}

#[cfg(target_os = "linux")]
fn platform_capture_focus() -> Option<PlatformTarget> {
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
    let xid = conn
        .get_property(false, root, active_atom, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?
        .value32()?
        .next()?;
    if xid == 0 {
        None
    } else {
        let process_id = conn
            .intern_atom(false, b"_NET_WM_PID")
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| {
                conn.get_property(false, xid, reply.atom, AtomEnum::CARDINAL, 0, 1)
                    .ok()
            })
            .and_then(|cookie| cookie.reply().ok())
            .and_then(|reply| reply.value32().and_then(|mut values| values.next()));
        if process_id == Some(std::process::id()) {
            return None;
        }
        Some(PlatformTarget(xid))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_capture_focus() -> Option<PlatformTarget> {
    None
}

#[cfg(target_os = "windows")]
pub fn simulate_paste(target: Option<FocusTarget>) -> Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
            VK_V,
        },
        WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow},
    };
    if let Some(FocusTarget(PlatformTarget(raw_hwnd))) = target {
        let hwnd = HWND(raw_hwnd as *mut std::ffi::c_void);
        unsafe {
            let _ = SetForegroundWindow(hwnd);
        }
        for _ in 0..20 {
            if unsafe { GetForegroundWindow() } == hwnd {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        // If the remembered HWND disappeared or Windows rejected explicit
        // activation, continue with the external window naturally focused by
        // hiding ClipsX.
    }
    let foreground = unsafe { GetForegroundWindow() };
    let mut foreground_process_id = 0;
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
            foreground,
            Some(&mut foreground_process_id),
        )
    };
    if foreground.0.is_null() || foreground_process_id == std::process::id() {
        anyhow::bail!("Windows has no valid external paste target")
    }
    let keyboard = |key, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [
        keyboard(VK_CONTROL, Default::default()),
        keyboard(VK_V, Default::default()),
        keyboard(VK_V, KEYEVENTF_KEYUP),
        keyboard(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        anyhow::bail!(
            "Windows paste simulation sent {sent}/{} input events",
            inputs.len()
        )
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn simulate_paste(target: Option<FocusTarget>) -> Result<()> {
    use cocoa::base::id;
    use core_graphics::{
        event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode},
        event_source::{CGEventSource, CGEventSourceStateID},
    };
    use objc::{class, msg_send, sel, sel_impl};
    if let Some(FocusTarget(PlatformTarget(pid))) = target {
        unsafe {
            // NSRunningApplication(forProcessIdentifier:) to restore focus.
            let cls = class!(NSRunningApplication);
            let app: id = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
            if app != cocoa::base::nil {
                // NSApplicationActivateIgnoringOtherApps = 2
                let _: bool = msg_send![app, activateWithOptions: 2u64];
            }
        }
    }
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| anyhow::anyhow!("could not create macOS event source"))?;
    for down in [true, false] {
        let event = CGEvent::new_keyboard_event(source.clone(), 9 as CGKeyCode, down)
            .map_err(|_| anyhow::anyhow!("could not create macOS paste event"))?;
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::Session);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn simulate_paste(target: Option<FocusTarget>) -> Result<()> {
    use x11rb::{connection::Connection, protocol::xtest::ConnectionExt};
    let (conn, screen) = x11rb::connect(None)?;
    if let Some(FocusTarget(PlatformTarget(xid))) = target {
        use x11rb::protocol::xproto::{ConnectionExt as XprotoExt, EventMask};
        let root = conn.setup().roots[screen].root;
        // Request the WM to activate the target window via _NET_ACTIVE_WINDOW.
        let active_atom = conn
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|r| r.atom)
            .unwrap_or(0);
        if active_atom != 0 {
            use x11rb::protocol::xproto::{ClientMessageData, ClientMessageEvent};
            let event = ClientMessageEvent {
                response_type: 33, // ClientMessage
                format: 32,
                sequence: 0,
                window: xid,
                type_: active_atom,
                data: ClientMessageData::from([2u32, 0, 0, 0, 0]),
            };
            let _ = conn
                .send_event(
                    false,
                    root,
                    EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                    event,
                )
                .and_then(|c| c.check());
            let _ = conn.flush();
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    // X11's Ctrl and V keycodes are layout dependent. XTest accepts the core
    // keycodes used by standard Xorg layouts; unsupported servers return an
    // actionable error instead of pretending a paste occurred.
    const CONTROL_L: u8 = 37;
    const V: u8 = 55;
    conn.xtest_fake_input(2, CONTROL_L, 0, 0, 0, 0, 0)?
        .check()?;
    conn.xtest_fake_input(2, V, 0, 0, 0, 0, 0)?.check()?;
    conn.xtest_fake_input(3, V, 0, 0, 0, 0, 0)?.check()?;
    conn.xtest_fake_input(3, CONTROL_L, 0, 0, 0, 0, 0)?
        .check()?;
    conn.flush()?;
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn simulate_paste(_target: Option<FocusTarget>) -> Result<()> {
    anyhow::bail!("quick paste is unsupported on this platform")
}
