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
mod events;
mod models;
mod plugins;
mod repositories;
mod services;
mod window_behavior;

use plugins::mac_rounded_corners;

fn updater_public_key() -> Option<String> {
    option_env!("TAURI_UPDATER_PUBLIC_KEY")
        .map(str::to_string)
        .or_else(|| std::env::var("TAURI_UPDATER_PUBLIC_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default().plugin(tauri_plugin_autostart::Builder::new().build());

    #[cfg(target_os = "windows")]
    {
        builder.plugin(tauri_plugin_decorum::init())
    }

    #[cfg(not(target_os = "windows"))]
    {
        builder
    }
}

fn main() {
    app_builder()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let updater_configured = updater_public_key().is_some();

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let mut updater_builder = tauri_plugin_updater::Builder::new();

                if let Some(pubkey) = updater_public_key() {
                    updater_builder = updater_builder.pubkey(pubkey);
                } else {
                    eprintln!(
                        "[UPDATER] TAURI_UPDATER_PUBLIC_KEY is not set. Auto-update will stay unavailable for this build."
                    );
                }

                app.handle().plugin(updater_builder.build())?;
            }

            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
                        let _ = commands::show_main_window(app);
                    }
                    "settings"
                        if commands::show_main_window(app).is_ok() => {
                            let _ = app.emit("open-settings", ());
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
                        let _ = commands::show_main_window(app);
                    }
                })
                .build(app)?;

            // Run async initialization synchronously inside setup so that
            // AppState is managed before the window becomes interactive.
            // Using block_on here is intentional — Tauri's setup closure is
            // synchronous, but we need async for DB migrations and service init.
            tauri::async_runtime::block_on(async move {
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
                    updater_configured,
                    #[cfg(target_os = "macos")]
                    previous_app_pid: std::sync::Mutex::new(None),
                };

                // Handle first launch
                let mut settings = app_state.settings_repository.load().unwrap_or_default();
                if !settings.has_seen_welcome {
                    let _ = commands::show_main_window(&app_handle);
                    settings.has_seen_welcome = true;
                    let _ = app_state.settings_repository.save(&settings);
                }

                // Apply initial window behavior settings
                if let Some(window) = app_handle.get_webview_window("main") {
                    window_behavior::reconcile_main_window(&app_handle, &window);
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
            commands::reset_settings,
            commands::get_settings_path,
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::reposition_traffic_lights,
            commands::open_text_in_editor,
            commands::open_path,
            commands::init_semantic_search,
            commands::set_semantic_search_enabled,
            commands::get_semantic_status,
            commands::get_semantic_search_status,
            commands::change_semantic_model,
            commands::get_downloaded_models,
            commands::get_semantic_index_stats,
            commands::delete_semantic_model,
            commands::reindex_semantic_embeddings,
            commands::generate_embedding,
            commands::get_tags,
            commands::create_tag,
            commands::delete_tag,
            commands::add_tag_to_clip,
            commands::remove_tag_from_clip,
            commands::get_tags_for_clip,
            commands::get_tags_for_clips,
            commands::update_clip_note,
            commands::get_release_info,
            commands::restart_app,
        ])
        .on_window_event(|window, event| {
            // Intercept the window close button (X).
            // On desktop apps, closing the window normally just hides it (tray app behavior).
            // We hook here to run cleanup logic when the user actually quits via tray → Quit.
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<commands::AppState>() {
                    let settings = state.settings_repository.load().unwrap_or_default();
                    if settings.clear_on_exit {
                        eprintln!("[EXIT] clear_on_exit=true — wiping clipboard history...");

                        // Spawn async cleanup task on tokio runtime
                        // This runs concurrently with app shutdown
                        let repo = state.repository.clone();
                        let clipboard_service = state.clipboard_service.clone();

                        tauri::async_runtime::spawn(async move {
                            // 1. Get all clips to delete their associated files
                            match repo.get_recent(i32::MAX).await {
                                Ok(clips) => {
                                    // 2. Delete all clip files
                                    for clip in clips {
                                        if let Err(e) = clipboard_service.cleanup_clip_files(&clip).await {
                                            eprintln!("[EXIT] Failed to clean up files for {}: {}", clip.id, e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[EXIT] Failed to fetch clips for cleanup: {}", e);
                                }
                            }

                            // 3. Clear database
                            if let Err(e) = repo.clear_all().await {
                                eprintln!("[EXIT] Failed to clear database: {}", e);
                            } else {
                                eprintln!("[EXIT] Clipboard history cleared successfully.");
                            }
                        });
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
