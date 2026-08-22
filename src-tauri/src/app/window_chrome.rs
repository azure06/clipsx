//! Native window chrome applied before the initially hidden main window is shown.

#![cfg_attr(target_os = "macos", allow(deprecated, unexpected_cfgs))]

use tauri::WebviewWindow;

#[cfg(any(target_os = "macos", test))]
const CORNER_RADIUS: f64 = 12.0;
#[cfg(any(target_os = "macos", test))]
const TRAFFIC_LIGHT_X: f64 = 14.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y: f64 = 0.0;

#[cfg(any(target_os = "macos", test))]
fn traffic_light_x(index: usize) -> f64 {
    TRAFFIC_LIGHT_X + index as f64 * 20.0
}

pub(crate) fn configure(_window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    configure_macos(_window)?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos(window: &WebviewWindow) -> tauri::Result<()> {
    use cocoa::{
        appkit::{NSView, NSWindow, NSWindowStyleMask, NSWindowTitleVisibility},
        base::{id, YES},
        foundation::{NSPoint, NSRect},
    };
    use objc::{msg_send, sel, sel_impl};

    window.with_webview(|webview| unsafe {
        let ns_window = webview.ns_window() as id;
        let style_mask = ns_window.styleMask()
            | NSWindowStyleMask::NSFullSizeContentViewWindowMask
            | NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSMiniaturizableWindowMask
            | NSWindowStyleMask::NSResizableWindowMask;

        ns_window.setStyleMask_(style_mask);
        ns_window.setTitlebarAppearsTransparent_(YES);
        ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
        ns_window.setHasShadow_(YES);
        ns_window.setOpaque_(cocoa::base::NO);

        let content_view = ns_window.contentView();
        content_view.setWantsLayer(YES);
        let layer: id = msg_send![content_view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: CORNER_RADIUS];
            let _: () = msg_send![layer, setMasksToBounds: YES];
        }

        for index in 0..3 {
            let button: id = msg_send![ns_window, standardWindowButton: index];
            if !button.is_null() {
                let frame: NSRect = msg_send![button, frame];
                let new_frame = NSRect::new(
                    NSPoint::new(traffic_light_x(index), TRAFFIC_LIGHT_Y),
                    frame.size,
                );
                let _: () = msg_send![button, setFrame: new_frame];
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_chrome_uses_the_shared_shell_geometry() {
        assert_eq!(CORNER_RADIUS, 12.0);
        assert_eq!(
            [traffic_light_x(0), traffic_light_x(1), traffic_light_x(2)],
            [14.0, 34.0, 54.0]
        );
    }
}
