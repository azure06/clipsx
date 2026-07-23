use crate::models::{EntitlementState, OfficeRestoreAllowance, FREE_OFFICE_RESTORE_LIMIT};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedEntitlementState {
    #[serde(default)]
    entitlement: EntitlementState,
    #[serde(default)]
    office_restores_used: u32,
}

pub struct EntitlementRepository {
    state_path: PathBuf,
    write_lock: Mutex<()>,
}

impl EntitlementRepository {
    pub fn new<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> Result<Self> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .context("Failed to get app config directory")?;
        fs::create_dir_all(&config_dir).context("Failed to create config directory")?;

        Ok(Self {
            state_path: config_dir.join("entitlement.json"),
            write_lock: Mutex::new(()),
        })
    }

    pub fn entitlement(&self) -> Result<EntitlementState> {
        Ok(self.load()?.entitlement)
    }

    pub fn cache_entitlement(&self, entitlement: EntitlementState) -> Result<()> {
        self.update(|state| state.entitlement = entitlement)
    }

    pub fn office_allowance(&self, now: i64) -> Result<OfficeRestoreAllowance> {
        let state = self.load()?;
        let unlimited = state.entitlement.has_pro_access_at(now);
        let used = state.office_restores_used.min(FREE_OFFICE_RESTORE_LIMIT);

        Ok(OfficeRestoreAllowance {
            limit: FREE_OFFICE_RESTORE_LIMIT,
            used,
            remaining: if unlimited {
                FREE_OFFICE_RESTORE_LIMIT
            } else {
                FREE_OFFICE_RESTORE_LIMIT.saturating_sub(used)
            },
            unlimited,
        })
    }

    pub fn can_restore_native_office(&self, now: i64) -> Result<bool> {
        let allowance = self.office_allowance(now)?;
        Ok(allowance.unlimited || allowance.remaining > 0)
    }

    pub fn record_native_office_restore(&self, now: i64) -> Result<OfficeRestoreAllowance> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Entitlement state lock poisoned"))?;
        let mut state = self.load_unlocked()?;

        if !state.entitlement.has_pro_access_at(now) {
            state.office_restores_used = state
                .office_restores_used
                .saturating_add(1)
                .min(FREE_OFFICE_RESTORE_LIMIT);
            self.save_unlocked(&state)?;
        }

        let unlimited = state.entitlement.has_pro_access_at(now);
        let used = state.office_restores_used.min(FREE_OFFICE_RESTORE_LIMIT);
        Ok(OfficeRestoreAllowance {
            limit: FREE_OFFICE_RESTORE_LIMIT,
            used,
            remaining: if unlimited {
                FREE_OFFICE_RESTORE_LIMIT
            } else {
                FREE_OFFICE_RESTORE_LIMIT.saturating_sub(used)
            },
            unlimited,
        })
    }

    fn load(&self) -> Result<PersistedEntitlementState> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Entitlement state lock poisoned"))?;
        self.load_unlocked()
    }

    fn load_unlocked(&self) -> Result<PersistedEntitlementState> {
        if !self.state_path.exists() {
            return Ok(PersistedEntitlementState::default());
        }

        let contents =
            fs::read_to_string(&self.state_path).context("Failed to read entitlement cache")?;
        serde_json::from_str(&contents).context("Failed to parse entitlement cache")
    }

    fn update(&self, updater: impl FnOnce(&mut PersistedEntitlementState)) -> Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Entitlement state lock poisoned"))?;
        let mut state = self.load_unlocked()?;
        updater(&mut state);
        self.save_unlocked(&state)
    }

    fn save_unlocked(&self, state: &PersistedEntitlementState) -> Result<()> {
        let json =
            serde_json::to_string_pretty(state).context("Failed to serialize entitlement cache")?;
        let temp_path = self.state_path.with_extension("json.tmp");
        fs::write(&temp_path, json).context("Failed to write entitlement cache")?;
        fs::rename(&temp_path, &self.state_path).context("Failed to replace entitlement cache")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EntitlementTier;
    use tempfile::TempDir;

    fn repository() -> (EntitlementRepository, TempDir) {
        let directory = TempDir::new().unwrap();
        let repository = EntitlementRepository {
            state_path: directory.path().join("entitlement.json"),
            write_lock: Mutex::new(()),
        };
        (repository, directory)
    }

    #[test]
    fn free_allowance_stops_after_ten_successes() {
        let (repository, _directory) = repository();

        for expected_remaining in (0..FREE_OFFICE_RESTORE_LIMIT).rev() {
            let allowance = repository.record_native_office_restore(100).unwrap();
            assert_eq!(allowance.remaining, expected_remaining);
        }

        assert!(!repository.can_restore_native_office(100).unwrap());
    }

    #[test]
    fn active_pro_access_is_unlimited_and_does_not_increment_usage() {
        let (repository, _directory) = repository();
        repository
            .cache_entitlement(EntitlementState {
                tier: EntitlementTier::Pro,
                expires_at: Some(200),
                ..EntitlementState::default()
            })
            .unwrap();

        let allowance = repository.record_native_office_restore(100).unwrap();
        assert!(allowance.unlimited);
        assert_eq!(allowance.used, 0);
    }
}
