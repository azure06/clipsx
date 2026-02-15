/// Quick Paste service — platform-specific paste simulation
///
/// Strategy: the Clips window is minimized/hidden, which lets the OS
/// automatically refocus whatever was behind it. Then we simulate
/// Ctrl+V (Windows) or ⌘V (macOS) to paste into that app.

// =============================================================================
// Windows Implementation
// =============================================================================
#[cfg(target_os = "windows")]
mod platform {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

    /// Simulate Ctrl+V keystroke
    pub fn simulate_paste() -> anyhow::Result<()> {
        let inputs = [
            // Ctrl down
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_CONTROL,
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // V down
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_V,
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // V up
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_V,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // Ctrl up
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_CONTROL,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };

        if sent != 4 {
            anyhow::bail!("SendInput failed: only {sent}/4 inputs sent");
        }

        Ok(())
    }
}

// =============================================================================
// macOS Implementation
// =============================================================================
#[cfg(target_os = "macos")]
mod platform {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // Virtual key code for 'V' on macOS
    const KV_V: CGKeyCode = 9;

    /// Simulate ⌘V keystroke
    pub fn simulate_paste() -> anyhow::Result<()> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| anyhow::anyhow!("Failed to create CGEventSource"))?;

        // Key down: ⌘V
        let key_down = CGEvent::new_keyboard_event(source.clone(), KV_V, true)
            .map_err(|_| anyhow::anyhow!("Failed to create key down event"))?;
        key_down.set_flags(CGEventFlags::CGEventFlagCommand);
        key_down.post(CGEventTapLocation::HID);

        // Key up: ⌘V
        let key_up = CGEvent::new_keyboard_event(source, KV_V, false)
            .map_err(|_| anyhow::anyhow!("Failed to create key up event"))?;
        key_up.set_flags(CGEventFlags::CGEventFlagCommand);
        key_up.post(CGEventTapLocation::HID);

        Ok(())
    }
}

// =============================================================================
// Linux / Other fallback
// =============================================================================
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    pub fn simulate_paste() -> anyhow::Result<()> {
        anyhow::bail!("Quick paste not supported on this platform")
    }
}

// =============================================================================
// Public API
// =============================================================================

/// Simulate a paste keystroke (Ctrl+V on Windows, ⌘V on macOS).
/// The clipboard should already be set before calling this.
/// The target app should already be in the foreground (e.g., by hiding our window first).
pub fn simulate_paste() -> anyhow::Result<()> {
    platform::simulate_paste()
}
