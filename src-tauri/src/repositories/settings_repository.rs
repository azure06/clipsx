use crate::models::AppSettings;
use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub struct SettingsRepository {
    config_path: PathBuf,
}

impl SettingsRepository {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .context("Failed to get app config directory")?;

        // Ensure config directory exists
        fs::create_dir_all(&config_dir).context("Failed to create config directory")?;

        let config_path = config_dir.join("settings.json");

        Ok(Self { config_path })
    }

    /// Load settings from file, or return defaults if file doesn't exist
    pub fn load(&self) -> Result<AppSettings> {
        if !self.config_path.exists() {
            // First run - return defaults
            return Ok(AppSettings::default());
        }

        let contents =
            fs::read_to_string(&self.config_path).context("Failed to read settings file")?;

        let settings: AppSettings =
            serde_json::from_str(&contents).context("Failed to parse settings JSON")?;

        Ok(settings)
    }

    /// Save settings to file atomically (write to temp, then rename)
    pub fn save(&self, settings: &AppSettings) -> Result<()> {
        let json =
            serde_json::to_string_pretty(settings).context("Failed to serialize settings")?;

        // Write to temporary file first
        let temp_path = self.config_path.with_extension("json.tmp");
        fs::write(&temp_path, json).context("Failed to write temporary settings file")?;

        // Atomic rename
        fs::rename(&temp_path, &self.config_path).context("Failed to rename settings file")?;

        Ok(())
    }

    /// Update specific settings fields (partial update)
    #[allow(dead_code)]
    pub fn update<F>(&self, updater: F) -> Result<AppSettings>
    where
        F: FnOnce(&mut AppSettings),
    {
        let mut settings = self.load()?;
        updater(&mut settings);
        self.save(&settings)?;
        Ok(settings)
    }

    /// Get the config file path (for debugging)
    pub fn config_path(&self) -> &PathBuf {
        &self.config_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_repo() -> (SettingsRepository, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("settings.json");
        let repo = SettingsRepository { config_path };
        (repo, temp_dir)
    }

    #[test]
    fn test_load_defaults_when_file_missing() {
        let (repo, _temp) = create_test_repo();
        let settings = repo.load().unwrap();
        assert_eq!(settings.enable_images, true);
        assert_eq!(settings.auto_close_after_paste, true);
    }

    #[test]
    fn test_save_and_load() {
        let (repo, _temp) = create_test_repo();

        let mut settings = AppSettings::default();
        settings.enable_images = false;
        settings.theme = crate::models::settings::Theme::Dark;

        repo.save(&settings).unwrap();

        let loaded = repo.load().unwrap();
        assert_eq!(loaded.enable_images, false);
    }

    #[test]
    fn test_update() {
        let (repo, _temp) = create_test_repo();

        // Initial save
        repo.save(&AppSettings::default()).unwrap();

        // Update
        let updated = repo
            .update(|s| {
                s.enable_images = false;
                s.excluded_apps.push("TestApp".to_string());
            })
            .unwrap();

        assert_eq!(updated.enable_images, false);
        assert_eq!(updated.excluded_apps.len(), 1);

        // Verify persistence
        let loaded = repo.load().unwrap();
        assert_eq!(loaded.enable_images, false);
    }
}
