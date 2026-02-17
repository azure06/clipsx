// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use commands::AppState;
use repositories::{ClipRepository, SettingsRepository};
use services::clipboard::ClipboardService;
use std::sync::Arc;
use tauri::{Emitter, Manager};

mod commands;
mod models;
mod plugins;
mod repositories;
mod services;

use plugins::mac_rounded_corners;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Initialize database
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            std::fs::create_dir_all(&app_dir).expect("Failed to create app directory");

            let db_path = app_dir.join("clips.db");
            let database_url = format!("sqlite:{}", db_path.display());

            let app_handle = app.handle().clone();

            // Initialize System Tray
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

            let show_i = MenuItem::with_id(app, "show", "Show/Hide Clips", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        let _ = commands::toggle_window(app);
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit("open-settings", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        // Just show the window on tray click to avoid conflict with hide_on_blur
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Spawn async initialization
            tauri::async_runtime::spawn(async move {
                let repository = Arc::new(
                    ClipRepository::new(&database_url)
                        .await
                        .expect("Failed to initialize database"),
                );

                let clipboard_service = Arc::new(ClipboardService::new(
                    repository.clone(),
                    app_handle.clone(),
                ));

                let settings_repository = Arc::new(
                    SettingsRepository::new(&app_handle)
                        .expect("Failed to initialize settings repository"),
                );

                // Start clipboard monitoring in background
                let clipboard_monitor = clipboard_service.clone();
                tokio::spawn(async move {
                    clipboard_monitor.start_monitoring().await;
                });

                let app_state = AppState {
                    repository,
                    clipboard_service,
                    settings_repository,
                };

                // Register global shortcut on startup
                let settings = app_state.settings_repository.load().unwrap_or_default();
                if let Err(e) =
                    commands::setup_global_shortcut(&app_handle, &settings.global_shortcut)
                {
                    eprintln!("Failed to register global shortcut on startup: {}", e);
                }

                app_handle.manage(app_state);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_recent_clips,
            commands::get_recent_clips_paginated,
            commands::get_clips_after_timestamp,
            commands::get_clip_by_id,
            commands::search_clips,
            commands::search_clips_paginated,
            commands::delete_clip,
            commands::toggle_favorite,
            commands::toggle_pin,
            commands::clear_all_clips,
            commands::copy_to_clipboard,
            commands::paste_clip,
            commands::get_clipboard_text,
            commands::register_global_shortcut,
            commands::get_settings,
            commands::update_settings,
            commands::get_settings_path,
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::reposition_traffic_lights,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
