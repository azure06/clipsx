use crate::commands::AppState;
use crate::models::AppSettings;
use crate::repositories::SettingsRepository;
use tauri::{Manager, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use cocoa::base::id;
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

pub(crate) fn reconcile_main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    let settings = load_effective_settings(app);
    apply_settings(window, &settings);
}

fn load_effective_settings<R: Runtime>(app: &tauri::AppHandle<R>) -> AppSettings {
    select_effective_settings(
        load_settings_from_state(app),
        load_settings_from_repository(app),
    )
}

fn load_settings_from_state<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<AppSettings> {
    let state = app.try_state::<AppState>()?;
    state.settings_repository.load().ok()
}

fn load_settings_from_repository<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<AppSettings> {
    let repository = SettingsRepository::new(app).ok()?;
    repository.load().ok()
}

fn apply_settings<R: Runtime>(window: &WebviewWindow<R>, settings: &AppSettings) {
    let _ = window.set_always_on_top(settings.always_on_top);

    #[cfg(target_os = "macos")]
    set_hides_on_deactivate(
        window,
        hides_on_deactivate(settings.hide_on_blur, settings.always_on_top),
    );
}

fn select_effective_settings(
    state_settings: Option<AppSettings>,
    repository_settings: Option<AppSettings>,
) -> AppSettings {
    state_settings.or(repository_settings).unwrap_or_default()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn hides_on_deactivate(hide_on_blur: bool, always_on_top: bool) -> bool {
    hide_on_blur && !always_on_top
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn set_hides_on_deactivate<R: Runtime>(window: &WebviewWindow<R>, hides: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(move |webview| unsafe {
            let ns_window = webview.ns_window() as id;
            let hides_val = if hides {
                cocoa::base::YES
            } else {
                cocoa::base::NO
            };
            let _: () = msg_send![ns_window, setHidesOnDeactivate: hides_val];
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_app_state_settings_over_repository_settings() {
        let state_settings = AppSettings {
            always_on_top: true,
            ..AppSettings::default()
        };
        let repository_settings = AppSettings {
            always_on_top: false,
            ..AppSettings::default()
        };

        let effective =
            select_effective_settings(Some(state_settings.clone()), Some(repository_settings));

        assert!(effective.always_on_top);
        assert_eq!(effective.always_on_top, state_settings.always_on_top);
    }

    #[test]
    fn falls_back_to_repository_settings_when_state_is_unavailable() {
        let repository_settings = AppSettings {
            always_on_top: true,
            ..AppSettings::default()
        };

        let effective = select_effective_settings(None, Some(repository_settings.clone()));

        assert!(effective.always_on_top);
        assert_eq!(effective.always_on_top, repository_settings.always_on_top);
    }

    #[test]
    fn falls_back_to_defaults_when_no_settings_source_is_available() {
        let effective = select_effective_settings(None, None);

        assert_eq!(
            effective.always_on_top,
            AppSettings::default().always_on_top
        );
    }

    #[test]
    fn hides_on_deactivate_respects_hide_on_blur_and_always_on_top() {
        assert!(hides_on_deactivate(true, false));
        assert!(!hides_on_deactivate(false, false));
        assert!(!hides_on_deactivate(true, true));
        assert!(!hides_on_deactivate(false, true));
    }
}
