// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use commands::AppState;
use repositories::{ClipRepository, SettingsRepository};
use services::clipboard::ClipboardService;
use services::semantic::SemanticService;
use std::sync::Arc;
use tauri::{Emitter, Manager};
#[cfg(target_os = "windows")]
use tauri_plugin_decorum::WebviewWindowExt;

mod commands;
mod models;
mod plugins;
mod repositories;
mod services;

use plugins::mac_rounded_corners;

fn main() {
    let mut builder = tauri::Builder::default();

    // Only use decorum plugin on Windows (macOS uses custom mac_rounded_corners plugin)
    #[cfg(target_os = "windows")]
    {
        builder = builder.plugin(tauri_plugin_decorum::init());
    }

    builder
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

            let open_i = MenuItem::with_id(app, "open", "Open Clips", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
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
                        // Always show — tray click should never hide the window.
                        // (toggle_window caused a flash because the click can briefly
                        //  focus the window right as the handler fires, making it hide.)
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_minimized().unwrap_or(false) {
                                let _ = window.unminimize();
                            }
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

                let settings_repository = Arc::new(
                    SettingsRepository::new(&app_handle)
                        .expect("Failed to initialize settings repository"),
                );

                let semantic_service = Arc::new(SemanticService::new(app_dir.clone()));

                let clipboard_service = Arc::new(ClipboardService::new(
                    repository.clone(),
                    settings_repository.clone(),
                    semantic_service.clone(),
                    app_handle.clone(),
                ));

                // Start clipboard monitoring in background
                let clipboard_monitor = clipboard_service.clone();
                tokio::spawn(async move {
                    clipboard_monitor.start_monitoring().await;
                });

                let app_state = AppState {
                    repository,
                    clipboard_service,
                    settings_repository: settings_repository.clone(),
                    semantic_service: semantic_service.clone(),
                };

                // Handle first launch
                let mut settings = app_state.settings_repository.load().unwrap_or_default();
                if !settings.has_seen_welcome {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    settings.has_seen_welcome = true;
                    let _ = app_state.settings_repository.save(&settings);
                }

                // Robust Startup Check for Semantic Models
                if settings.semantic_search_enabled {
                    let downloaded_models = app_state.semantic_service.get_downloaded_models();
                    if downloaded_models.contains(&settings.semantic_model) {
                        // Model is available on disk, load it
                        let semantic_service = app_state.semantic_service.clone();
                        let model_name = settings.semantic_model.clone();
                        let app_handle_clone = app_handle.clone();
                        tokio::spawn(async move {
                            if let Err(e) = semantic_service.init_model(model_name, Some(app_handle_clone)).await {
                                eprintln!("Failed to initialize semantic model on startup: {}", e);
                            }
                        });
                    } else {
                        // Model was deleted or not fully downloaded: Self-heal the state
                        eprintln!(
                            "Semantic model {} is enabled but missing from disk. Self-healing state...",
                            settings.semantic_model
                        );
                        settings.semantic_search_enabled = false;
                        let _ = app_state.settings_repository.save(&settings);
                    }
                }

                // Register global shortcut on startup
                if let Err(e) =
                    commands::setup_global_shortcut(&app_handle, &settings.global_shortcut)
                {
                    eprintln!("Failed to register global shortcut on startup: {}", e);
                }

                app_handle.manage(app_state);
            });

            // Create custom overlay titlebar on Windows
            // macOS titlebar is handled by mac_rounded_corners plugin separately
            #[cfg(target_os = "windows")]
            {
                let main_window = app.get_webview_window("main").unwrap();
                main_window.create_overlay_titlebar().unwrap();
            }

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
            commands::open_text_in_editor,
            commands::open_path,
            commands::init_semantic_search,
            commands::get_semantic_search_status,
            commands::change_semantic_model,
            commands::get_downloaded_models,
            commands::delete_semantic_model,
            commands::generate_embedding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
