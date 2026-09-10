//! Saved intent is durable; native effects are reconciled on startup and retry.
use crate::history::{AppSettings, HistoryRepository};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

pub fn merge_settings(
    current: AppSettings,
    patch: serde_json::Value,
) -> Result<AppSettings, String> {
    fn merge(target: &mut serde_json::Value, patch: serde_json::Value) -> Result<(), String> {
        let object = patch
            .as_object()
            .ok_or("Settings patch must be an object")?;
        for (key, value) in object {
            if matches!(key.as_str(), "managedBytesUsed" | "retentionWarning") {
                return Err("Read-only setting".into());
            }
            let field = target.get_mut(key).ok_or("Unknown setting")?;
            if field.is_object() {
                merge(field, value.clone())?;
            } else {
                *field = value.clone();
            }
        }
        Ok(())
    }
    let mut value = serde_json::to_value(current).map_err(|_| "Unable to read settings")?;
    merge(&mut value, patch)?;
    let settings: AppSettings =
        serde_json::from_value(value).map_err(|_| "Invalid setting type")?;
    settings.validate().map_err(|e| e.to_string())?;
    Ok(settings)
}

fn native_effects(
    shortcut: impl FnOnce() -> bool,
    autostart: impl FnOnce() -> bool,
    window: impl FnOnce() -> bool,
) -> Vec<String> {
    [
        ("shortcut", shortcut()),
        ("autostart", autostart()),
        ("window", window()),
    ]
    .into_iter()
    .filter(|(_, success)| !success)
    .map(|(name, _)| name.into())
    .collect()
}

#[derive(Default)]
pub struct SettingsLifecycle {
    pub gate: tokio::sync::Mutex<()>,
    failures: Mutex<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResult {
    pub settings: AppSettings,
    pub failed_effects: Vec<String>,
}

impl SettingsLifecycle {
    pub fn failures(&self) -> Vec<String> {
        self.failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn record_failure(&self, effect: &str) {
        let mut failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        if !failures.iter().any(|value| value == effect) {
            failures.push(effect.into());
        }
    }

    pub async fn reconcile(
        &self,
        app: &tauri::AppHandle,
        repo: &HistoryRepository,
        settings: AppSettings,
    ) -> SettingsResult {
        super::diagnostics::set_enabled(settings.logging_enabled);
        let host = app.state::<super::state::HostState>();
        let mut failed = native_effects(
            || {
                host.global_shortcut
                    .replace(app, &settings.global_shortcut)
                    .is_ok()
            },
            || {
                let autostart = app.autolaunch();
                autostart
                    .is_enabled()
                    .and_then(|enabled| {
                        if enabled == settings.auto_start {
                            Ok(())
                        } else if settings.auto_start {
                            autostart.enable()
                        } else {
                            autostart.disable()
                        }
                    })
                    .is_ok()
            },
            || {
                app.get_webview_window("main").is_some_and(|window| {
                    host.window_behavior
                        .apply_settings(&window, &settings)
                        .is_ok()
                })
            },
        );
        if repo.enforce_retention(&settings.capture).await.is_err() {
            failed.push("retention".into());
        }
        for effect in &failed {
            crate::diagnostic!("[SETTINGS] Effect requires recovery: {effect}");
        }
        *self.failures.lock().unwrap_or_else(|e| e.into_inner()) = failed.clone();
        let _ = app.emit("app-settings-updated", ());
        SettingsResult {
            settings,
            failed_effects: failed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn patches_preserve_unedited_limits_and_reject_bad_input() {
        let current = AppSettings::default();
        let next = merge_settings(
            current.clone(),
            json!({"captureFilters":{"images":false},"loggingEnabled":false}),
        )
        .unwrap();
        assert!(!next.capture_filters.images);
        assert!(next.capture_filters.files);
        assert_eq!(
            next.capture.max_snapshot_bytes,
            current.capture.max_snapshot_bytes
        );
        for patch in [
            json!({"theme":"invalid"}),
            json!({"language":"fr"}),
            json!({"loggingEnabled":"true"}),
            json!({"unknown":true}),
            json!({"capture":{"maxAgeDays":-1}}),
            json!({"capture":{"maxAgeDays":0}}),
            json!({"capture":{"maxManagedBytes":1_099_511_627_777u64}}),
            json!({"capture":{"managedBytesUsed":1}}),
            json!({"captureFilters":{"unknown":true}}),
            json!({"globalShortcut":"invalid shortcut!"}),
            json!({"excludedApps":["\n"]}),
            json!({"autoClearMinutes":4}),
        ] {
            assert!(
                merge_settings(current.clone(), patch.clone()).is_err(),
                "{patch}"
            );
        }
    }

    #[test]
    fn native_failures_are_independent_and_retry_clears_them() {
        let attempted = std::cell::Cell::new(0);
        let failures = native_effects(
            || {
                attempted.set(attempted.get() + 1);
                false
            },
            || {
                attempted.set(attempted.get() + 1);
                false
            },
            || {
                attempted.set(attempted.get() + 1);
                false
            },
        );
        assert_eq!(attempted.get(), 3);
        assert_eq!(failures, ["shortcut", "autostart", "window"]);
        assert!(native_effects(|| true, || true, || true).is_empty());
    }

    #[tokio::test]
    async fn saved_settings_restart_reset_and_database_failure() {
        let (_temp, repo) = crate::sync::tests::repo().await;
        let changed = merge_settings(AppSettings::default(), json!({"theme":"dark","loggingEnabled":false,"autoStart":true,"capture":{"maxOrdinaryClips":12}})).unwrap();
        repo.save_app_settings(&changed, false).await.unwrap();
        sqlx::query("INSERT INTO config_command_shortcuts VALUES('core.copy','Primary+J',0)")
            .execute(&repo.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO config_profile_values VALUES('artifacts.ocr.language','\"ja\"',0,0) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        let restarted = repo.app_settings().await.unwrap();
        assert!(!restarted.logging_enabled);
        assert!(restarted.auto_start);
        sqlx::query("CREATE TRIGGER fail_settings BEFORE UPDATE ON config_profile_values WHEN NEW.key='ui.theme' BEGIN SELECT RAISE(ABORT,'injected disk failure'); END").execute(&repo.pool).await.unwrap();
        assert!(repo
            .save_app_settings(&AppSettings::default(), true)
            .await
            .is_err());
        assert_eq!(
            repo.app_settings()
                .await
                .unwrap()
                .capture
                .max_ordinary_clips,
            Some(12)
        );
        assert!(crate::sync::command_shortcuts(&repo)
            .await
            .unwrap()
            .contains_key("core.copy"));
        sqlx::query("DROP TRIGGER fail_settings")
            .execute(&repo.pool)
            .await
            .unwrap();
        repo.save_app_settings(&AppSettings::default(), true)
            .await
            .unwrap();
        let reset = repo.app_settings().await.unwrap();
        assert!(reset.logging_enabled);
        assert!(!reset.auto_start);
        assert!(crate::sync::command_shortcuts(&repo)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            crate::artifacts::ocr_settings(&repo)
                .await
                .unwrap()
                .language,
            "ja"
        );
    }
}
