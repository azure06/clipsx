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
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Global shortcut state is unavailable")?;
        if let Some(value) = active.as_deref() {
            let shortcut = value
                .parse::<Shortcut>()
                .map_err(|_| "Invalid global shortcut")?;
            app.global_shortcut()
                .unregister(shortcut)
                .map_err(|_| "Unable to remove shortcut")?;
        }
        *active = None;
        Ok(())
    }

    pub fn replace(&self, app: &tauri::AppHandle, requested: &str) -> Result<(), String> {
        requested
            .parse::<Shortcut>()
            .map_err(|error| format!("Invalid global shortcut: {error}"))?;
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
