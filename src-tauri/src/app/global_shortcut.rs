use std::sync::Mutex;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Default)]
pub struct GlobalShortcutState {
    active: Mutex<Option<String>>,
}

impl GlobalShortcutState {
    pub fn current(&self) -> Option<String> {
        self.active.lock().ok().and_then(|value| value.clone())
    }

    pub fn clear(&self, app: &tauri::AppHandle) -> Result<(), String> {
        self.replace(app, "")
    }

    pub fn replace(&self, app: &tauri::AppHandle, requested: &str) -> Result<(), String> {
        if !requested.is_empty() {
            requested
                .parse::<Shortcut>()
                .map_err(|error| format!("Invalid global shortcut: {error}"))?;
        }
        let manager = app.global_shortcut();
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Global shortcut state is unavailable".to_string())?;
        replace_registration(
            &mut active,
            requested,
            |value| {
                let shortcut = value
                    .parse::<Shortcut>()
                    .map_err(|error| error.to_string())?;
                manager
                    .register(shortcut)
                    .map_err(|error| error.to_string())
            },
            |value| {
                let shortcut = value
                    .parse::<Shortcut>()
                    .map_err(|error| error.to_string())?;
                manager
                    .unregister(shortcut)
                    .map_err(|error| error.to_string())
            },
        )
    }
}

fn replace_registration(
    active: &mut Option<String>,
    requested: &str,
    mut register: impl FnMut(&str) -> Result<(), String>,
    mut unregister: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    if requested.is_empty() {
        if let Some(previous) = active.as_deref() {
            unregister(previous).map_err(|error| format!("Could not remove shortcut: {error}"))?;
        }
        *active = None;
        return Ok(());
    }
    if active.as_deref() == Some(requested) {
        return Ok(());
    }

    register(requested).map_err(|error| format!("Could not register shortcut: {error}"))?;
    if let Some(previous) = active.as_deref() {
        if let Err(error) = unregister(previous) {
            if unregister(requested).is_err() {
                return Err("Could not replace shortcut or remove the replacement. Restart ClipsX to recover.".into());
            }
            return Err(format!("Could not replace the existing shortcut: {error}"));
        }
    }
    *active = Some(requested.to_string());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn clearing_unregisters_without_registering_and_is_idempotent() {
        let removed = RefCell::new(Vec::new());
        let mut active = Some("Ctrl+Alt+V".to_string());
        for _ in 0..2 {
            replace_registration(
                &mut active,
                "",
                |_| panic!("must not register an empty shortcut"),
                |value| {
                    removed.borrow_mut().push(value.to_string());
                    Ok(())
                },
            )
            .unwrap();
            assert_eq!(active, None);
        }
        assert_eq!(removed.into_inner(), ["Ctrl+Alt+V"]);
    }

    #[test]
    fn failed_clear_preserves_the_working_shortcut() {
        let mut active = Some("Ctrl+Alt+V".to_string());
        let error = replace_registration(
            &mut active,
            "",
            |_| panic!("must not register"),
            |_| Err("platform failure".into()),
        )
        .unwrap_err();
        assert!(error.contains("Could not remove shortcut"));
        assert_eq!(active.as_deref(), Some("Ctrl+Alt+V"));
    }

    #[test]
    fn disabled_shortcut_can_be_enabled_again() {
        let mut active = None;
        replace_registration(
            &mut active,
            "Ctrl+Alt+V",
            |_| Ok(()),
            |_| panic!("must not unregister"),
        )
        .unwrap();
        assert_eq!(active.as_deref(), Some("Ctrl+Alt+V"));
    }

    #[test]
    fn successful_replacement_registers_before_unregistering() {
        let operations = RefCell::new(Vec::new());
        let mut active = Some("Ctrl+Shift+V".to_string());
        replace_registration(
            &mut active,
            "Ctrl+Alt+V",
            |value| {
                operations.borrow_mut().push(format!("register:{value}"));
                Ok(())
            },
            |value| {
                operations.borrow_mut().push(format!("unregister:{value}"));
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(active.as_deref(), Some("Ctrl+Alt+V"));
        assert_eq!(
            operations.into_inner(),
            ["register:Ctrl+Alt+V", "unregister:Ctrl+Shift+V"]
        );
    }

    #[test]
    fn failed_registration_preserves_the_working_shortcut() {
        let mut active = Some("Ctrl+Shift+V".to_string());
        let result = replace_registration(
            &mut active,
            "Ctrl+Alt+V",
            |_| Err("already registered".into()),
            |_| Ok(()),
        );

        assert!(result.is_err());
        assert_eq!(active.as_deref(), Some("Ctrl+Shift+V"));
    }

    #[test]
    fn unchanged_registration_is_a_no_op() {
        let mut active = Some("Ctrl+Shift+V".to_string());
        replace_registration(
            &mut active,
            "Ctrl+Shift+V",
            |_| panic!("must not register"),
            |_| panic!("must not unregister"),
        )
        .unwrap();
    }
}
