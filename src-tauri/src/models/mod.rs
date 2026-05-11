// Data models and types
pub mod clip;
pub mod settings;

pub use clip::{compute_index_text, ClipItem, ClipTagEntry, Embedding, Tag};
pub use settings::AppSettings;
