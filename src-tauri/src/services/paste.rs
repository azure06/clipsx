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
    pub fn simulate_paste(_target_pid: Option<i32>) -> anyhow::Result<()> {
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
    use core_graphics::sys::CGEventRef;
    use foreign_types::ForeignType;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: *mut std::ffi::c_void) -> u8;
        fn CGEventPostToPid(pid: i32, event: CGEventRef);
    }

    // Virtual key code for 'V' on macOS
    const KV_V: CGKeyCode = 9;

    fn ensure_accessibility_permission() -> anyhow::Result<()> {
        let trusted = unsafe { AXIsProcessTrusted() != 0 };
        if trusted {
            return Ok(());
        }

        // Trigger the system permission dialog.
        unsafe {
            use cocoa::base::{id, nil};
            use cocoa::foundation::NSString;
            use objc::{class, msg_send, sel, sel_impl};

            let key: id = NSString::alloc(nil).init_str("AXTrustedCheckOptionPrompt");
            let val: id = msg_send![class!(NSNumber), numberWithBool: cocoa::base::YES];
            let dict: id = msg_send![class!(NSDictionary),
                dictionaryWithObject: val
                forKey: key
            ];
            AXIsProcessTrustedWithOptions(dict as *mut std::ffi::c_void);
        }

        anyhow::bail!(
            "macOS Accessibility permission is required to simulate paste. Enable ClipsX in System Settings > Privacy & Security > Accessibility."
        )
    }

    fn post_event(event: &CGEvent, target_pid: Option<i32>) {
        if let Some(pid) = target_pid.filter(|pid| *pid > 0) {
            // Deliver directly to the previously frontmost app so we do not
            // depend on AppKit restoring the exact first responder after the
            // overlay window was shown.
            unsafe {
                CGEventPostToPid(pid, event.as_ptr());
            }
        } else {
            event.post(CGEventTapLocation::Session);
        }
    }

    /// Simulate ⌘V keystroke.
    pub fn simulate_paste(target_pid: Option<i32>) -> anyhow::Result<()> {
        ensure_accessibility_permission()?;

        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
            .map_err(|_| anyhow::anyhow!("Failed to create CGEventSource"))?;

        // Key down: ⌘V
        let key_down = CGEvent::new_keyboard_event(source.clone(), KV_V, true)
            .map_err(|_| anyhow::anyhow!("Failed to create key down event"))?;
        key_down.set_flags(CGEventFlags::CGEventFlagCommand);
        post_event(&key_down, target_pid);

        // Key up: ⌘V
        let key_up = CGEvent::new_keyboard_event(source, KV_V, false)
            .map_err(|_| anyhow::anyhow!("Failed to create key up event"))?;
        key_up.set_flags(CGEventFlags::CGEventFlagCommand);
        post_event(&key_up, target_pid);

        Ok(())
    }
}

// =============================================================================
// Linux / Other fallback
// =============================================================================
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    pub fn simulate_paste(_target_pid: Option<i32>) -> anyhow::Result<()> {
        anyhow::bail!("Quick paste not supported on this platform")
    }
}

// =============================================================================
// Public API
// =============================================================================

/// Simulate a paste keystroke (Ctrl+V on Windows, ⌘V on macOS).
/// The clipboard should already be set before calling this.
/// The target app should already be in the foreground (e.g., by hiding our window first).
pub fn simulate_paste(target_pid: Option<i32>) -> anyhow::Result<()> {
    platform::simulate_paste(target_pid)
}
