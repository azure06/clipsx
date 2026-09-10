//! Application diagnostics contain only reviewed operational messages and numbers.
use std::sync::atomic::{AtomicBool, Ordering};

// Stay quiet until the persisted policy has been read.
static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

pub async fn initialize(database: &std::path::Path) -> anyhow::Result<()> {
    use sqlx::Connection;
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(database)
        .read_only(true);
    let mut connection = sqlx::SqliteConnection::connect_with(&options).await?;
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT value_json FROM config_device_values WHERE key='diagnostics.logging_enabled'",
    )
    .fetch_optional(&mut connection)
    .await?;
    let value = stored
        .as_deref()
        .map(serde_json::from_str::<bool>)
        .transpose()?
        .unwrap_or(true);
    set_enabled(value);
    connection.close().await?;
    Ok(())
}

#[macro_export]
macro_rules! diagnostic {
    ($($arg:tt)*) => {
        if $crate::app::diagnostics::enabled() {
            eprintln!($($arg)*);
        }
    };
}

pub fn frontend_message(event: &str) -> Option<&'static str> {
    match event {
        "auth_deep_link_callback_received" => Some("[AUTH] Deep-link callback received"),
        "auth_deep_link_listener_registered" => Some("[AUTH] Deep-link listener registered"),
        "auth_falling_back_to_the_hosted_auth_callback_bridge" => {
            Some("[AUTH] Falling back to the hosted auth callback bridge")
        }
        "auth_initial_deep_link_state" => Some("[AUTH] Initial deep-link state"),
        "auth_secure_storage_read" => Some("[AUTH] Secure storage read"),
        "auth_secure_storage_remove" => Some("[AUTH] Secure storage remove"),
        "auth_secure_storage_write" => Some("[AUTH] Secure storage write"),
        "auth_supabase_pkce_code_exchange_failed" => {
            Some("[AUTH] Supabase PKCE code exchange failed")
        }
        "auth_using_local_auth_callback_listener" => {
            Some("[AUTH] Using local auth callback listener")
        }
        "errorboundary_caught_an_error" => Some("ErrorBoundary caught an error"),
        "failed_to_close_pending_updater_resource" => {
            Some("Failed to close pending updater resource")
        }
        "failed_to_initialize_application_language" => {
            Some("Failed to initialize application language")
        }
        "failed_to_reset_settings" => Some("Failed to reset settings"),
        "failed_to_toggle_autostart" => Some("Failed to toggle autostart"),
        "failed_to_update_tray_language" => Some("Failed to update tray language"),
        "window_unable_to_show_snap_layout" => Some("[WINDOW] Unable to show Snap Layout"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn logging_can_be_disabled_and_never_accepts_arbitrary_frontend_content() {
        let (temp, repo) = crate::sync::tests::repo().await;
        let database = temp.path().join("data/clips.db");
        initialize(&database).await.unwrap();
        assert!(enabled());
        let mut settings = repo.app_settings().await.unwrap();
        settings.logging_enabled = false;
        repo.save_app_settings(&settings, false).await.unwrap();
        initialize(&database).await.unwrap();
        assert!(!enabled());
        set_enabled(false);
        let formatted = std::cell::Cell::new(false);
        crate::diagnostic!("{}", {
            formatted.set(true);
            "sensitive-sentinel"
        });
        assert!(!formatted.get());
        assert!(frontend_message("secret-token-sentinel").is_none());
        assert!(frontend_message("C:\\Users\\private\\note.txt").is_none());
        assert_eq!(
            frontend_message("auth_deep_link_callback_received"),
            Some("[AUTH] Deep-link callback received")
        );
        set_enabled(true);
        assert!(enabled());
        set_enabled(false);
    }
}
