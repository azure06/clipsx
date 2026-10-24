//! Keep browser zoom disabled while allowing precision-trackpad pinch events.
#[cfg(target_os = "windows")]
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("preview-gestures")
        .js_init_script_on_all_frames(include_str!("preview_pinch_guard.js").to_string())
        .on_webview_ready(|webview| {
            if webview
                .with_webview(|platform| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
                    use windows::core::Interface;

                    let configure = || -> windows::core::Result<()> {
                        let settings = platform.controller().CoreWebView2()?.Settings()?;
                        // Wry ties both settings to zoom_hotkeys_enabled=false. Only
                        // enable pinch recognition; retain disabled browser hotkeys.
                        settings
                            .cast::<ICoreWebView2Settings5>()?
                            .SetIsPinchZoomEnabled(true)?;
                        Ok(())
                    };
                    if configure().is_err() {
                        log::warn!("preview native pinch configuration failed");
                    }
                })
                .is_err()
            {
                log::warn!("preview native webview configuration unavailable");
            }
        })
        .build()
}
