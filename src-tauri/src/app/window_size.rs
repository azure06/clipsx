//! Native, device-local size persistence. Activation waits for startup restoration;
//! no renderer or extension owns the main window's geometry.

use crate::history::{HistoryRepository, NormalWindowSize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{Manager, Window};
use tokio::sync::{Mutex as AsyncMutex, Notify};

const SAVE_DELAY: Duration = Duration::from_millis(500);
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
struct SizeState {
    repo: Option<HistoryRepository>,
    observed: Option<NormalWindowSize>,
    preferred: Option<NormalWindowSize>,
    persisted: Option<NormalWindowSize>,
}

impl SizeState {
    fn observe(&mut self, size: NormalWindowSize) {
        if size.is_valid() && !self.observed.is_some_and(|old| old.approximately_eq(size)) {
            self.observed = Some(size);
            self.preferred = Some(size);
        }
    }

    fn pending(&self) -> Option<(HistoryRepository, NormalWindowSize)> {
        let size = self.preferred?;
        if self.persisted == Some(size) {
            return None;
        }
        Some((self.repo.clone()?, size))
    }
}

#[derive(Default)]
pub struct WindowSizeController {
    ready: AtomicBool,
    notification: Notify,
    generation: AtomicU64,
    state: Mutex<SizeState>,
    writer: AsyncMutex<()>,
    hide_gate: AsyncMutex<()>,
    exit_started: AtomicBool,
    exit_ready: AtomicBool,
}

/// Every startup path, including storage recovery, must release activation.
pub struct StartupGuard(pub Arc<WindowSizeController>);
impl Drop for StartupGuard {
    fn drop(&mut self) {
        self.0.ready.store(true, Ordering::SeqCst);
        self.0.notification.notify_waiters();
    }
}

// Work-area dimensions already exclude taskbars/menu bars. Native borders consume
// additional space outside the persisted content dimensions.
fn fitted_size(
    preferred: NormalWindowSize,
    available: Option<NormalWindowSize>,
) -> (NormalWindowSize, NormalWindowSize) {
    let minimum = NormalWindowSize {
        width: 600.0,
        height: 450.0,
    };
    let Some(available) = available.filter(|size| size.is_valid()) else {
        return (
            NormalWindowSize {
                width: preferred.width.max(minimum.width),
                height: preferred.height.max(minimum.height),
            },
            minimum,
        );
    };
    let minimum = NormalWindowSize {
        width: minimum.width.min(available.width),
        height: minimum.height.min(available.height),
    };
    (
        NormalWindowSize {
            width: preferred.width.clamp(minimum.width, available.width),
            height: preferred.height.clamp(minimum.height, available.height),
        },
        minimum,
    )
}

fn logical_size(physical: tauri::PhysicalSize<u32>, scale: f64) -> Option<NormalWindowSize> {
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let size = NormalWindowSize {
        width: f64::from(physical.width) / scale,
        height: f64::from(physical.height) / scale,
    };
    size.is_valid().then_some(size)
}

fn sample(window: &Window) -> Option<NormalWindowSize> {
    let physical = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    // Check mode after reading dimensions: a resize during maximize must not
    // pair its new bounds with an earlier normal-state observation.
    let normal = window.is_visible().ok()?
        && !window.is_minimized().ok()?
        && !window.is_maximized().ok()?
        && !window.is_fullscreen().ok()?;
    normal_sample(physical, scale, normal)
}

fn normal_sample(
    physical: tauri::PhysicalSize<u32>,
    scale: f64,
    normal: bool,
) -> Option<NormalWindowSize> {
    normal.then(|| logical_size(physical, scale)).flatten()
}

impl WindowSizeController {
    pub fn begin_exit(&self) -> bool {
        !self.exit_started.swap(true, Ordering::SeqCst)
    }

    pub fn exit_ready(&self) -> bool {
        self.exit_ready.load(Ordering::SeqCst)
    }

    pub fn finish_exit(&self) {
        self.exit_ready.store(true, Ordering::SeqCst);
    }
    pub async fn wait_until_ready(&self) {
        loop {
            let notified = self.notification.notified();
            // Register before checking the flag, so startup cannot release between them.
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.ready.load(Ordering::SeqCst) {
                return;
            }
            notified.await;
        }
    }

    /// Called synchronously during setup, while the main window is still hidden.
    pub fn restore(&self, window: &Window, repo: &HistoryRepository) {
        let saved = match tauri::async_runtime::block_on(repo.normal_window_size()) {
            Ok(size) => size,
            Err(_) => {
                crate::diagnostic!("window.size.read_failed");
                None
            }
        };
        let preferred = saved.unwrap_or_default();
        let available = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten())
            .and_then(|monitor| {
                let mut available = logical_size(monitor.work_area().size, monitor.scale_factor())?;
                if let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) {
                    available.width -=
                        f64::from(outer.width.saturating_sub(inner.width)) / monitor.scale_factor();
                    available.height -= f64::from(outer.height.saturating_sub(inner.height))
                        / monitor.scale_factor();
                }
                available.is_valid().then_some(available)
            });
        let (size, minimum) = fitted_size(preferred, available);
        if window
            .set_min_size(Some(tauri::LogicalSize::new(minimum.width, minimum.height)))
            .is_err()
            || window
                .set_size(tauri::LogicalSize::new(size.width, size.height))
                .is_err()
        {
            crate::diagnostic!("window.size.restore_failed");
            return;
        }
        // Positioning is advisory: some Linux compositors choose placement themselves.
        if window.center().is_err() {
            crate::diagnostic!("window.size.center_unavailable");
        }
        *self.state.lock().unwrap_or_else(|error| error.into_inner()) = SizeState {
            repo: Some(repo.clone()),
            observed: Some(size),
            preferred: saved,
            persisted: saved,
        };
    }

    async fn capture(&self, window: Window, generation: u64) {
        if !self.ready.load(Ordering::SeqCst) {
            return;
        }
        let size = tauri::async_runtime::spawn_blocking(move || sample(&window))
            .await
            .ok()
            .flatten();
        self.accept_sample(generation, size);
    }

    fn accept_sample(&self, generation: u64, size: Option<NormalWindowSize>) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if self.generation.load(Ordering::SeqCst) == generation {
            if let Some(size) = size {
                state.observe(size);
            }
        }
    }

    async fn after_quiet_period(&self, generation: u64) -> bool {
        tokio::time::sleep(SAVE_DELAY).await;
        self.generation.load(Ordering::SeqCst) == generation && self.ready.load(Ordering::SeqCst)
    }

    async fn persist(&self) {
        // A single writer always fetches the newest desired size after acquiring the
        // lock. An older in-flight write can never overwrite a newer completed write.
        let _writer = self.writer.lock().await;
        loop {
            let pending = self
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .pending();
            let Some((repo, size)) = pending else {
                return;
            };
            if repo.set_normal_window_size(size).await.is_err() {
                crate::diagnostic!("window.size.save_failed");
                return;
            }
            self.state
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .persisted = Some(size);
        }
    }

    pub fn resized(self: &Arc<Self>, window: Window) {
        if !self.ready.load(Ordering::SeqCst) {
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let controller = self.clone();
        tauri::async_runtime::spawn(async move {
            if !controller.after_quiet_period(generation).await {
                return;
            }
            controller.capture(window, generation).await;
            controller.persist().await;
        });
    }

    pub async fn flush(&self, window: Window) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if tokio::time::timeout(FLUSH_TIMEOUT, async {
            self.capture(window, generation).await;
            self.persist().await;
        })
        .await
        .is_err()
        {
            crate::diagnostic!("window.size.flush_timeout");
        }
    }

    pub async fn remember_before_hide(self: &Arc<Self>, window: Window) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if tokio::time::timeout(FLUSH_TIMEOUT, self.capture(window, generation))
            .await
            .is_err()
        {
            crate::diagnostic!("window.size.capture_timeout");
        }
        // Do not delay paste/focus handoff for a disk write.
        let controller = self.clone();
        tauri::async_runtime::spawn(async move {
            controller.persist().await;
        });
    }

    pub async fn hide(self: &Arc<Self>, window: Window) -> tauri::Result<()> {
        let _hide = self.hide_gate.lock().await;
        self.remember_before_hide(window.clone()).await;
        window.hide()?;
        Ok(())
    }
}

pub fn controller(app: &tauri::AppHandle) -> Arc<WindowSizeController> {
    app.state::<Arc<WindowSizeController>>().inner().clone()
}

pub async fn flush(app: &tauri::AppHandle) {
    if let Ok(window) = super::host::main_window(app) {
        controller(app).flush(window).await;
    }
}

pub async fn hide(window: Window) -> tauri::Result<()> {
    controller(window.app_handle()).hide(window).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(width: f64, height: f64) -> NormalWindowSize {
        NormalWindowSize { width, height }
    }

    async fn repository() -> (tempfile::TempDir, HistoryRepository) {
        let directory = tempfile::tempdir().unwrap();
        let roots = crate::foundation::AppRoots {
            data: directory.path().join("data"),
            config: directory.path().join("config"),
        };
        crate::foundation::prepare(&roots).await.unwrap();
        let repo = HistoryRepository::connect(&roots.database(), roots.clipboard_data())
            .await
            .unwrap();
        (directory, repo)
    }

    #[test]
    fn fits_content_to_work_area_without_exceeding_small_displays() {
        assert_eq!(
            fitted_size(size(1400.0, 900.0), Some(size(1000.0, 700.0))).0,
            size(1000.0, 700.0)
        );
        assert_eq!(fitted_size(size(300.0, 200.0), None).0, size(600.0, 450.0));
        let (actual, minimum) = fitted_size(NormalWindowSize::default(), Some(size(500.0, 350.0)));
        assert_eq!(actual, size(500.0, 350.0));
        assert_eq!(minimum, actual);
        assert_eq!(
            fitted_size(NormalWindowSize::default(), None).0,
            NormalWindowSize::default()
        );
        assert_eq!(
            fitted_size(NormalWindowSize::default(), Some(size(0.0, 0.0))).0,
            NormalWindowSize::default()
        );
    }

    #[test]
    fn samples_normal_content_in_logical_pixels_only() {
        let physical = tauri::PhysicalSize::new(1800, 1200);
        assert_eq!(
            normal_sample(physical, 1.5, true),
            Some(size(1200.0, 800.0))
        );
        // Hidden, minimized, maximized and fullscreen windows all fail the native normal-state predicate.
        assert_eq!(normal_sample(physical, 1.5, false), None);
        assert_eq!(normal_sample(physical, 0.0, true), None);
        assert_eq!(normal_sample(physical, f64::NAN, true), None);
        assert_eq!(
            normal_sample(tauri::PhysicalSize::new(0, 0), 1.0, true),
            None
        );
    }

    #[test]
    fn fitting_and_scale_rounding_never_replace_the_preferred_size() {
        let preferred = size(1400.0, 900.0);
        let fitted = fitted_size(preferred, Some(size(900.0, 600.0))).0;
        let mut state = SizeState {
            observed: Some(fitted),
            preferred: Some(preferred),
            persisted: Some(preferred),
            ..Default::default()
        };
        state.observe(fitted);
        state.observe(size(fitted.width + 0.3, fitted.height - 0.3));
        assert_eq!(state.preferred, Some(preferred));
        state.observe(size(800.0, 500.0));
        assert_eq!(state.preferred, Some(size(800.0, 500.0)));
        state.observe(size(f64::NAN, 500.0));
        assert_eq!(state.preferred, Some(size(800.0, 500.0)));
        assert!(SizeState::default().pending().is_none());
    }

    #[tokio::test]
    async fn activation_waits_for_restoration_and_recovery_releases_it() {
        let controller = Arc::new(WindowSizeController::default());
        assert!(
            tokio::time::timeout(Duration::from_millis(10), controller.wait_until_ready())
                .await
                .is_err()
        );
        let waiting = controller.clone();
        let activation = tokio::spawn(async move {
            waiting.wait_until_ready().await;
        });
        tokio::task::yield_now().await;
        drop(StartupGuard(controller.clone()));
        tokio::time::timeout(Duration::from_secs(1), activation)
            .await
            .unwrap()
            .unwrap();
        // A later activation also completes, even though the notification already happened.
        controller.wait_until_ready().await;
        assert!(controller.begin_exit());
        assert!(!controller.begin_exit());
        assert!(!controller.exit_ready());
        controller.finish_exit();
        assert!(controller.exit_ready());
    }

    #[tokio::test]
    async fn resize_debounce_rejects_superseded_and_initialization_events() {
        let controller = WindowSizeController::default();
        assert!(!controller.after_quiet_period(0).await);
        controller.ready.store(true, Ordering::SeqCst);
        controller.generation.store(2, Ordering::SeqCst);
        let (stale, latest) = tokio::join!(
            controller.after_quiet_period(1),
            controller.after_quiet_period(2)
        );
        assert!(!stale);
        assert!(latest);
        controller.accept_sample(1, Some(size(1000.0, 700.0)));
        assert_eq!(controller.state.lock().unwrap().preferred, None);
        controller.accept_sample(2, Some(size(900.0, 600.0)));
        assert_eq!(
            controller.state.lock().unwrap().preferred,
            Some(size(900.0, 600.0))
        );
        controller.accept_sample(2, None);
        assert_eq!(
            controller.state.lock().unwrap().preferred,
            Some(size(900.0, 600.0))
        );
    }

    #[tokio::test]
    async fn repository_validates_and_roundtrips_only_device_local_size() {
        let (_directory, repo) = repository().await;
        assert_eq!(repo.normal_window_size().await.unwrap(), None);
        for invalid in [
            size(-1.0, 600.0),
            size(900.0, 0.0),
            size(f64::INFINITY, 600.0),
        ] {
            assert!(repo.set_normal_window_size(invalid).await.is_err());
        }
        repo.set_normal_window_size(size(1234.5, 678.0))
            .await
            .unwrap();
        assert_eq!(
            repo.normal_window_size().await.unwrap(),
            Some(size(1234.5, 678.0))
        );
        repo.save_app_settings(&crate::history::AppSettings::default(), true)
            .await
            .unwrap();
        assert_eq!(
            repo.normal_window_size().await.unwrap(),
            Some(size(1234.5, 678.0))
        );
        let portable = crate::sync::portable::export(&repo).await.unwrap();
        assert!(!portable.contains("window.normal_size"));
        for invalid in [
            "not json",
            "{}",
            "{\"width\":0,\"height\":600}",
            "{\"width\":\"900\",\"height\":600}",
        ] {
            sqlx::query(
                "UPDATE config_device_values SET value_json=? WHERE key='window.normal_size'",
            )
            .bind(invalid)
            .execute(&repo.pool)
            .await
            .unwrap();
            assert_eq!(repo.normal_window_size().await.unwrap(), None);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM config_profile_values WHERE key='window.normal_size'",
        )
        .fetch_one(&repo.pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn queued_writers_save_the_newest_size_and_failed_writes_remain_retryable() {
        let (_directory, repo) = repository().await;
        let controller = Arc::new(WindowSizeController::default());
        *controller.state.lock().unwrap() = SizeState {
            repo: Some(repo.clone()),
            preferred: Some(size(900.0, 600.0)),
            ..Default::default()
        };
        let guard = controller.writer.lock().await;
        let first = controller.clone();
        let first = tokio::spawn(async move {
            first.persist().await;
        });
        controller
            .state
            .lock()
            .unwrap()
            .observe(size(1000.0, 700.0));
        let second = controller.clone();
        let second = tokio::spawn(async move {
            second.persist().await;
        });
        drop(guard);
        first.await.unwrap();
        second.await.unwrap();
        assert_eq!(
            repo.normal_window_size().await.unwrap(),
            Some(size(1000.0, 700.0))
        );
        assert!(controller.state.lock().unwrap().pending().is_none());
        repo.pool.close().await;
        controller
            .state
            .lock()
            .unwrap()
            .observe(size(1100.0, 750.0));
        controller.persist().await;
        assert_eq!(
            controller.state.lock().unwrap().pending().unwrap().1,
            size(1100.0, 750.0)
        );
    }
}
