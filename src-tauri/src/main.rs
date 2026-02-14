// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use commands::AppState;
use repositories::{ClipRepository, SettingsRepository};
use services::clipboard::ClipboardService;
use std::sync::Arc;
use tauri::Manager;

mod commands;
mod services;
mod repositories;
mod models;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            
            // Initialize database
            let app_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            
            std::fs::create_dir_all(&app_dir)
                .expect("Failed to create app directory");
            
            let db_path = app_dir.join("clips.db");
            let database_url = format!("sqlite:{}", db_path.display());
            
            let app_handle = app.handle().clone();
            
            // Spawn async initialization
            tauri::async_runtime::spawn(async move {
                let repository = Arc::new(
                    ClipRepository::new(&database_url)
                        .await
                        .expect("Failed to initialize database")
                );
                
                let clipboard_service = Arc::new(
                    ClipboardService::new(repository.clone(), app_handle.clone())
                );
                
                let settings_repository = Arc::new(
                    SettingsRepository::new(&app_handle)
                        .expect("Failed to initialize settings repository")
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
            commands::get_clipboard_text,
            commands::register_global_shortcut,
            commands::toggle_window_visibility,
            commands::get_settings,
            commands::update_settings,
            commands::get_settings_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


