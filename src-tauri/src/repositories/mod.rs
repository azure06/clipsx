// Data access layer
pub mod clip_repository;
pub mod settings_repository;

pub use clip_repository::{ClipIndexStateRow, ClipRepository, SEARCH_DOCUMENT_VERSION};
pub use settings_repository::SettingsRepository;
