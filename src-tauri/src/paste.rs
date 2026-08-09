//! Platform paste simulation. Clipboard writes happen before this module is
//! invoked, so a simulation failure leaves the copied result available.
use anyhow::Result;

#[cfg(target_os = "windows")]
pub fn simulate_paste() -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };
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
pub fn simulate_paste() -> Result<()> {
    use core_graphics::{
        event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode},
        event_source::{CGEventSource, CGEventSourceStateID},
    };
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
pub fn simulate_paste() -> Result<()> {
    use x11rb::{connection::Connection, protocol::xtest::ConnectionExt};
    let (conn, _) = x11rb::connect(None)?;
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
pub fn simulate_paste() -> Result<()> {
    anyhow::bail!("quick paste is unsupported on this platform")
}
