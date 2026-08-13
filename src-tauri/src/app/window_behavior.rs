//! Native main-window behavior. React does not decide when the OS window hides.

use crate::history::AppSettings;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{WebviewWindow, Window};

const BLUR_DELAY: Duration = Duration::from_millis(250);
const INTERACTION_GUARD: Duration = Duration::from_millis(300);

pub struct WindowBehaviorState {
    hide_on_blur: AtomicBool,
    always_on_top: AtomicBool,
    generation: AtomicU64,
    interaction_until: Mutex<Instant>,
}

impl Default for WindowBehaviorState {
    fn default() -> Self {
        Self {
            hide_on_blur: AtomicBool::new(true),
            always_on_top: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            interaction_until: Mutex::new(Instant::now()),
        }
    }
}

impl WindowBehaviorState {
    pub fn apply_settings(&self, window: &WebviewWindow, settings: &AppSettings) {
        self.hide_on_blur
            .store(settings.hide_on_blur, Ordering::SeqCst);
        self.always_on_top
            .store(settings.always_on_top, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        let _ = window.set_always_on_top(settings.always_on_top);
    }

    pub fn mark_native_interaction(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut until) = self.interaction_until.lock() {
            *until = Instant::now() + INTERACTION_GUARD;
        }
    }

    pub fn mark_focused(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn schedule_blur_hide(self: &std::sync::Arc<Self>, window: Window) {
        if !self.hide_on_blur.load(Ordering::SeqCst) || self.always_on_top.load(Ordering::SeqCst) {
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let guard_delay = self
            .interaction_until
            .lock()
            .ok()
            .and_then(|until| until.checked_duration_since(Instant::now()))
            .unwrap_or_default();
        let delay = BLUR_DELAY.max(guard_delay);
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            if state.generation.load(Ordering::SeqCst) != generation
                || !state.hide_on_blur.load(Ordering::SeqCst)
                || state.always_on_top.load(Ordering::SeqCst)
                || window.is_focused().unwrap_or(true)
            {
                return;
            }
            let _ = window.hide();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_product_window_behavior() {
        let state = WindowBehaviorState::default();
        assert!(state.hide_on_blur.load(Ordering::SeqCst));
        assert!(!state.always_on_top.load(Ordering::SeqCst));
    }

    #[test]
    fn native_interaction_cancels_a_pending_generation() {
        let state = WindowBehaviorState::default();
        let pending = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        state.mark_native_interaction();
        assert_ne!(state.generation.load(Ordering::SeqCst), pending);
    }
}
