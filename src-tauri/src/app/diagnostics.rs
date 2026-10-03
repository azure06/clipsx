//! Privacy-preserving local diagnostics and remote error reporting.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row};
use std::{
    borrow::Cow,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const DIAGNOSTICS_SCHEMA_VERSION: u32 = 2;
const MAX_LOG_FILE_BYTES: u128 = 2_000_000;
const RETAINED_LOG_FILES: usize = 5;

static SENTRY_INITIALIZED: AtomicBool = AtomicBool::new(false);
static STARTUP_FAILURE: LazyLock<RwLock<Option<String>>> = LazyLock::new(|| RwLock::new(None));
static LAST_SUBMISSION: LazyLock<RwLock<Option<String>>> = LazyLock::new(|| RwLock::new(None));

static VERBOSE_ENABLED: AtomicBool = AtomicBool::new(false);
// Fail closed until the persisted device policy has been loaded.
static ERROR_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
static INSTALLATION_ID: LazyLock<RwLock<String>> = LazyLock::new(|| RwLock::new(String::new()));

pub fn set_verbose_enabled(enabled: bool) {
    VERBOSE_ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn verbose_enabled() -> bool {
    VERBOSE_ENABLED.load(Ordering::SeqCst)
}

pub fn set_error_reporting_enabled(enabled: bool) {
    ERROR_REPORTING_ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn error_reporting_enabled() -> bool {
    ERROR_REPORTING_ENABLED.load(Ordering::SeqCst)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn log_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let file = Target::new(TargetKind::LogDir {
        file_name: Some("clipsx".into()),
    })
    .filter(|metadata| {
        metadata.target().starts_with("clipsx::")
            && (metadata.level() <= log::Level::Info || verbose_enabled())
    })
    .format(|out, message, record| {
        let value = serde_json::json!({
            "timestampMs": now_ms(),
            "level": record.level().to_string().to_lowercase(),
            "component": record.target().strip_prefix("clipsx::").unwrap_or(record.target()),
            "event": message.to_string(),
            "release": release_name(),
            "supportCode": support_code(),
        });
        out.finish(format_args!("{value}"));
    });
    let mut targets = vec![file];
    if cfg!(debug_assertions) {
        targets.push(
            Target::new(TargetKind::Stderr)
                .filter(|metadata| {
                    metadata.target().starts_with("clipsx::")
                        && (metadata.level() <= log::Level::Info || verbose_enabled())
                })
                .format(|out, message, record| {
                    let value = serde_json::json!({
                        "timestampMs": now_ms(),
                        "level": record.level().to_string().to_lowercase(),
                        "component": record.target().strip_prefix("clipsx::").unwrap_or(record.target()),
                        "event": message.to_string(),
                        "release": release_name(),
                        "supportCode": support_code(),
                    });
                    out.finish(format_args!("{value}"));
                }),
        );
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Trace)
        .timezone_strategy(TimezoneStrategy::UseUtc)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(RETAINED_LOG_FILES))
        .build()
}

fn sanitize_native_event(
    mut event: sentry::protocol::Event<'static>,
) -> sentry::protocol::Event<'static> {
    event.request = None;
    event.server_name = None;
    event.extra.clear();
    event.breadcrumbs.values.retain(|breadcrumb| {
        breadcrumb
            .category
            .as_deref()
            .is_some_and(|category| category.starts_with("clipsx."))
    });
    for breadcrumb in &mut event.breadcrumbs.values {
        breadcrumb.message = breadcrumb.category.clone();
        breadcrumb.data.clear();
    }
    super::telemetry::enrich_runtime(&mut event);
    if let Some(message) = event.message.as_mut() {
        *message = "A native application failure occurred".into();
    }
    for value in event.exception.values.iter_mut() {
        value.value = Some("A native application failure occurred".into());
    }
    event
}

pub fn initialize_sentry() -> Option<sentry::ClientInitGuard> {
    let explicitly_enabled = std::env::var("CLIPSX_SENTRY_ENABLED").as_deref() == Ok("true");
    if cfg!(debug_assertions) && !explicitly_enabled {
        return None;
    }
    let dsn = option_env!("SENTRY_DSN")
        .map(str::to_owned)
        .or_else(|| std::env::var("SENTRY_DSN").ok())?
        .parse()
        .ok()?;
    let mut options = sentry::ClientOptions::default();
    options.dsn = Some(dsn);
    options.release = Some(Cow::Owned(release_name()));
    options.environment = Some(Cow::Borrowed(if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    }));
    options.send_default_pii = false;
    options.attach_stacktrace = true;
    options.before_send = Some(std::sync::Arc::new(|event| {
        if !error_reporting_enabled() {
            return None;
        }
        Some(sanitize_native_event(event))
    }));
    options.before_breadcrumb = Some(std::sync::Arc::new(|breadcrumb| {
        breadcrumb
            .category
            .as_deref()
            .is_some_and(|category| category.starts_with("clipsx."))
            .then_some(breadcrumb)
    }));
    let guard = sentry::init(options);
    SENTRY_INITIALIZED.store(true, Ordering::SeqCst);
    sentry::configure_scope(|scope| {
        scope.set_tag("layer", "native");
    });
    Some(guard)
}

pub async fn initialize(database: &Path) -> anyhow::Result<()> {
    set_error_reporting_enabled(false);
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(database)
        .create_if_missing(false);
    let mut connection = sqlx::SqliteConnection::connect_with(&options).await?;
    let rows = sqlx::query(
        "SELECT key,value_json FROM config_device_values WHERE key IN ('diagnostics.verbose_logging_enabled','diagnostics.error_reporting_enabled','diagnostics.installation_id')",
    )
    .fetch_all(&mut connection)
    .await?;
    let mut verbose = false;
    let mut reporting = true;
    let mut installation_id = None;
    for row in rows {
        let key: String = row.get(0);
        let value: String = row.get(1);
        match key.as_str() {
            "diagnostics.verbose_logging_enabled" => verbose = serde_json::from_str(&value)?,
            "diagnostics.error_reporting_enabled" => reporting = serde_json::from_str(&value)?,
            "diagnostics.installation_id" => installation_id = Some(serde_json::from_str(&value)?),
            _ => {}
        }
    }
    let installation_id = installation_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    let now = crate::history::now_ms();
    sqlx::query("INSERT INTO config_device_values(key,value_json,created_at,updated_at) VALUES('diagnostics.installation_id',?,?,?) ON CONFLICT(key) DO NOTHING")
        .bind(serde_json::to_string(&installation_id)?)
        .bind(now)
        .bind(now)
        .execute(&mut connection)
        .await?;
    connection.close().await?;
    set_verbose_enabled(verbose);
    set_error_reporting_enabled(reporting);
    *INSTALLATION_ID.write().unwrap_or_else(|e| e.into_inner()) = installation_id;
    set_identity(None);
    Ok(())
}

pub fn release_name() -> String {
    option_env!("SENTRY_RELEASE")
        .unwrap_or(concat!("clipsx-desktop@", env!("CARGO_PKG_VERSION")))
        .to_owned()
}

pub fn support_code() -> String {
    let id = INSTALLATION_ID.read().unwrap_or_else(|e| e.into_inner());
    if id.is_empty() {
        return "PENDING".into();
    }
    let digest = format!("{:x}", Sha256::digest(id.as_bytes()));
    digest[..10].to_ascii_uppercase()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryIdentity {
    pub id: String,
    pub email: Option<String>,
    pub username: Option<String>,
    pub auth_provider: String,
}

fn bounded(value: String, maximum: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(maximum)
        .collect()
}

pub fn set_identity(identity: Option<TelemetryIdentity>) {
    let installation_id = INSTALLATION_ID
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    sentry::configure_scope(move |scope| {
        scope.set_tag("support_code", support_code());
        scope.set_tag("installation_id", installation_id.clone());
        match identity {
            Some(identity) => {
                let provider = match identity.auth_provider.as_str() {
                    "google" | "github" | "email" => identity.auth_provider,
                    _ => "unknown".into(),
                };
                scope.set_tag("auth_provider", provider);
                scope.set_user(Some(sentry::User {
                    id: Some(bounded(identity.id, 128)),
                    email: identity.email.map(|value| bounded(value, 254)),
                    username: identity.username.map(|value| bounded(value, 100)),
                    ip_address: None,
                    ..Default::default()
                }));
            }
            None => {
                scope.set_tag("auth_provider", "signed_out");
                scope.set_user((!installation_id.is_empty()).then_some(sentry::User {
                    id: Some(installation_id),
                    ..Default::default()
                }));
            }
        }
    });
}

pub fn breadcrumb(event: &'static str) {
    sentry::add_breadcrumb(sentry::Breadcrumb {
        category: Some(format!("clipsx.{event}")),
        message: Some(event.into()),
        level: sentry::Level::Info,
        ..Default::default()
    });
}

pub fn report_error(code: &'static str) {
    if error_reporting_enabled() {
        sentry::with_scope(
            |scope| scope.set_tag("error_code", code),
            || {
                sentry::capture_message(
                    "A terminal application operation failed",
                    sentry::Level::Error,
                );
            },
        );
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    schema_version: u32,
    support_code: String,
    release: String,
    os: &'static str,
    architecture: &'static str,
    verbose_logging_enabled: bool,
    error_reporting_enabled: bool,
    pending_index_jobs: i64,
    failed_index_jobs: i64,
    sentry_configured: bool,
    sentry_initialized: bool,
    startup_failure: Option<String>,
    last_submission_event_id: Option<String>,
    pending_cleanup_items: i64,
}

pub async fn summary(
    repo: Option<&crate::history::HistoryRepository>,
) -> anyhow::Result<DiagnosticsSummary> {
    let (pending_index_jobs, failed_index_jobs, pending_cleanup_items) = if let Some(repo) = repo {
        let pending_index_jobs = sqlx::query_scalar(
            "SELECT count(*) FROM search_index_jobs WHERE status IN ('pending','running')",
        )
        .fetch_one(&repo.pool)
        .await
        .unwrap_or(0);
        let failed_index_jobs =
            sqlx::query_scalar("SELECT count(*) FROM search_index_jobs WHERE status='failed'")
                .fetch_one(&repo.pool)
                .await
                .unwrap_or(0);
        let pending_cleanup_items =
            sqlx::query_scalar("SELECT count(*) FROM search_semantic_cleanup")
                .fetch_one(&repo.pool)
                .await
                .unwrap_or(0);
        (pending_index_jobs, failed_index_jobs, pending_cleanup_items)
    } else {
        (0, 0, 0)
    };
    Ok(DiagnosticsSummary {
        schema_version: DIAGNOSTICS_SCHEMA_VERSION,
        sentry_configured: configured_dsn().is_some(),
        sentry_initialized: SENTRY_INITIALIZED.load(Ordering::SeqCst),
        startup_failure: STARTUP_FAILURE
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
        last_submission_event_id: LAST_SUBMISSION
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
        support_code: support_code(),
        release: release_name(),
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        verbose_logging_enabled: verbose_enabled(),
        error_reporting_enabled: error_reporting_enabled(),
        pending_index_jobs,
        failed_index_jobs,
        pending_cleanup_items,
    })
}

pub fn log_directory<R: Runtime>(app: &tauri::AppHandle<R>) -> anyhow::Result<PathBuf> {
    Ok(app.path().app_log_dir()?)
}

pub async fn export_bundle<R: Runtime>(
    app: &tauri::AppHandle<R>,
    repo: Option<&crate::history::HistoryRepository>,
    destination: &Path,
) -> anyhow::Result<()> {
    let summary = summary(repo).await?;
    let output = fs::File::create(destination)?;
    let mut archive = zip::ZipWriter::new(output);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    archive.start_file("diagnostics.json", options)?;
    archive.write_all(serde_json::to_string_pretty(&summary)?.as_bytes())?;
    archive.start_file("README.txt", options)?;
    archive.write_all(b"ClipsX diagnostic bundle. Contains bounded operational logs and a sanitized device summary. It never contains clipboard data, databases, settings, credentials, screenshots, or search indexes.\n")?;
    let log_dir = log_directory(app)?;
    if let Ok(entries) = fs::read_dir(log_dir) {
        let mut entries = entries.flatten().collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries.into_iter().take(RETAINED_LOG_FILES) {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("clipsx"))
            {
                continue;
            }
            let file = fs::File::open(&path)?;
            let mut bytes = Vec::new();
            file.take(MAX_LOG_FILE_BYTES as u64)
                .read_to_end(&mut bytes)?;
            archive.start_file(
                format!("logs/{}", path.file_name().unwrap().to_string_lossy()),
                options,
            )?;
            archive.write_all(&bytes)?;
        }
    }
    archive.finish()?;
    Ok(())
}

pub fn open_log_directory<R: Runtime>(app: &tauri::AppHandle<R>) -> anyhow::Result<()> {
    let path = log_directory(app)?;
    fs::create_dir_all(&path)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&path).spawn()?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&path).spawn()?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&path).spawn()?;
    Ok(())
}

#[macro_export]
macro_rules! diagnostic {
    ($($arg:tt)*) => {{
        log::info!(target: "clipsx::diagnostics", $($arg)*);
    }};
}

#[macro_export]
macro_rules! diagnostic_debug {
    ($($arg:tt)*) => {{
        if $crate::app::diagnostics::verbose_enabled() {
            log::debug!(target: "clipsx::diagnostics", $($arg)*);
        }
    }};
}

pub fn frontend_message(event: &str) -> Option<&'static str> {
    match event {
        "auth_deep_link_callback_received" => Some("auth.deep_link.received"),
        "auth_deep_link_listener_registered" => Some("auth.deep_link.listener_registered"),
        "auth_falling_back_to_the_hosted_auth_callback_bridge" => {
            Some("auth.callback.hosted_fallback")
        }
        "auth_initial_deep_link_state" => Some("auth.deep_link.initial_state"),
        "auth_secure_storage_read" => Some("auth.storage.read"),
        "auth_secure_storage_remove" => Some("auth.storage.remove"),
        "auth_secure_storage_write" => Some("auth.storage.write"),
        "auth_supabase_pkce_code_exchange_failed" => Some("auth.pkce.failed"),
        "auth_using_local_auth_callback_listener" => Some("auth.callback.local_listener"),
        "errorboundary_caught_an_error" => Some("ui.error_boundary.caught"),
        "failed_to_close_pending_updater_resource" => Some("update.resource.close_failed"),
        "failed_to_initialize_application_language" => Some("app.language.initialization_failed"),
        "failed_to_reset_settings" => Some("settings.reset.failed"),
        "failed_to_toggle_autostart" => Some("settings.autostart.failed"),
        "failed_to_update_tray_language" => Some("tray.language.failed"),
        "window_unable_to_show_snap_layout" => Some("window.snap_layout.failed"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_events_remove_content_and_retain_only_reviewed_breadcrumbs() {
        let event: sentry::protocol::Event<'static> = serde_json::from_value(serde_json::json!({
            "message": "private-content-sentinel",
            "server_name": "private-content-sentinel",
            "request": { "url": "https://private-content-sentinel/", "headers": {"Cookie": "private-content-sentinel"}, "data": "private-content-sentinel" },
            "extra": { "content": "private-content-sentinel" },
            "exception": { "values": [{ "type": "Error", "value": "private-content-sentinel" }] },
            "breadcrumbs": { "values": [{"category":"http", "message":"private-content-sentinel"}, {"category":"clipsx.error", "message":"private-content-sentinel", "data":{"content":"private-content-sentinel"}}] }
        })).unwrap();
        let sanitized = sanitize_native_event(event);
        assert_eq!(sanitized.breadcrumbs.values.len(), 1);
        if let Some(request) = &sanitized.request {
            assert!(request.url.is_none());
            assert_eq!(request.headers.len(), 1);
            assert!(request.headers.contains_key("User-Agent"));
        }
        assert!(!serde_json::to_string(&sanitized)
            .unwrap()
            .contains("private-content-sentinel"));
    }

    #[tokio::test]
    async fn policies_are_loaded_and_frontend_messages_are_allowlisted() {
        let (temp, repo) = crate::sync::tests::repo().await;
        let database = temp.path().join("data/clips.db");
        initialize(&database).await.unwrap();
        assert!(!verbose_enabled());
        assert!(error_reporting_enabled());
        assert_ne!(support_code(), "PENDING");
        let mut settings = repo.app_settings().await.unwrap();
        settings.verbose_logging_enabled = true;
        settings.error_reporting_enabled = false;
        repo.save_app_settings(&settings, false).await.unwrap();
        initialize(&database).await.unwrap();
        assert!(verbose_enabled());
        assert!(!error_reporting_enabled());
        assert!(frontend_message("secret-token-sentinel").is_none());
        assert!(frontend_message("C:\\Users\\private\\note.txt").is_none());
        assert_eq!(
            frontend_message("auth_deep_link_callback_received"),
            Some("auth.deep_link.received")
        );
        sqlx::query("UPDATE config_device_values SET value_json='invalid-json' WHERE key='diagnostics.error_reporting_enabled'").execute(&repo.pool).await.unwrap();
        set_error_reporting_enabled(true);
        assert!(initialize(&database).await.is_err());
        assert!(!error_reporting_enabled());
    }
}

fn configured_dsn() -> Option<sentry::types::Dsn> {
    option_env!("SENTRY_DSN")
        .map(str::to_owned)
        .or_else(|| std::env::var("SENTRY_DSN").ok())?
        .parse()
        .ok()
}

pub fn startup_failure(code: &str) {
    *STARTUP_FAILURE.write().unwrap_or_else(|e| e.into_inner()) = Some(code.to_owned());
    log::error!(target: "clipsx::startup", "startup.failed code={code}");
}

// Only operational errors belong here, never guest output or authentication payloads.
pub fn operational_error(code: &str, error: &anyhow::Error) {
    let mut details = format!("{error:#}");
    for (name, value) in std::env::vars() {
        if value.len() >= 8
            && (name.contains("TOKEN")
                || name.contains("PASSWORD")
                || name.contains("PRIVATE_KEY")
                || name.contains("DSN"))
        {
            details = details.replace(&value, "[redacted]");
        }
    }
    log::error!(target: "clipsx::diagnostics", "{code} details={}", details.chars().take(4096).collect::<String>());
}

pub fn install_panic_logging() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Payloads may contain user content; retain the location and full technical stack.
        log::error!(target: "clipsx::diagnostics", "native.panic location={:?} backtrace={}", info.location(), std::backtrace::Backtrace::force_capture());
        previous(info);
    }));
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSelection {
    pub path: String,
    pub sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSubmission {
    pub event_id: String,
    pub status: &'static str,
}

pub async fn submit_report<R: Runtime>(
    app: &tauri::AppHandle<R>,
    consent: bool,
    selected: Option<ReportSelection>,
    include_logs: bool,
) -> anyhow::Result<ReportSubmission> {
    if !consent {
        anyhow::bail!("Explicit report-upload consent is required");
    }
    let dsn = configured_dsn()
        .ok_or_else(|| anyhow::anyhow!("Sentry is not configured in this build"))?;
    let report = if let Some(selection) = selected {
        let report = super::crash_reports::selected(Path::new(&selection.path), &selection.sha256)?;
        Some(report)
    } else {
        None
    };
    let event = sanitize_native_event(sentry::protocol::Event {
        message: Some("User submitted a diagnostic report".into()),
        level: sentry::Level::Error,
        release: Some(Cow::Owned(release_name())),
        environment: Some(Cow::Borrowed(if cfg!(debug_assertions) {
            "development"
        } else {
            "production"
        })),
        ..Default::default()
    });
    let event_id = event.event_id.simple().to_string();
    let mut envelope = sentry::Envelope::new();
    envelope.add_item(event);
    envelope.add_item(sentry::protocol::Attachment {
        buffer: serde_json::to_vec_pretty(&summary(None).await?)?,
        filename: "diagnostics.json".into(),
        content_type: Some("application/json".into()),
        ..Default::default()
    });
    if let Some(report) = report {
        envelope.add_item(sentry::protocol::Attachment {
            buffer: report.text.into_bytes(),
            filename: "ClipsX.ips".into(),
            content_type: Some("application/json".into()),
            ty: Some(sentry::protocol::AttachmentType::AppleCrashReport),
        });
    }
    if include_logs {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("diagnostics.zip");
        export_bundle(app, None, &path).await?;
        envelope.add_item(sentry::protocol::Attachment {
            buffer: fs::read(path)?,
            filename: "diagnostics.zip".into(),
            content_type: Some("application/zip".into()),
            ..Default::default()
        });
    }
    let mut body = Vec::new();
    envelope.to_writer(&mut body)?;
    // One consented request, independent of automatic reporting policy. No persistent upload queue.
    send_report_bytes(&dsn, &body, std::time::Duration::from_secs(15)).await?;
    *LAST_SUBMISSION.write().unwrap_or_else(|e| e.into_inner()) = Some(event_id.clone());
    // HTTP acceptance does not prove downstream ingestion or symbolication.
    Ok(ReportSubmission {
        event_id,
        status: "accepted",
    })
}

async fn send_report_bytes(
    dsn: &sentry::types::Dsn,
    body: &[u8],
    timeout: std::time::Duration,
) -> anyhow::Result<()> {
    let response = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()?
        .post(dsn.envelope_api_url())
        .header(
            "X-Sentry-Auth",
            dsn.to_auth(Some("clipsx/manual-report")).to_string(),
        )
        .header("Content-Type", "application/x-sentry-envelope")
        .body(body.to_vec())
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Report upload failed; local files have been retained"))?;
    if !response.status().is_success() {
        anyhow::bail!(
            "Report upload rejected (HTTP {}); local files have been retained",
            response.status().as_u16()
        );
    }
    Ok(())
}

#[cfg(test)]
mod submission_tests {
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    async fn manual_transport_reports_rejection_and_acceptance_without_claiming_ingestion() {
        for status in [200, 503] {
            let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = server.local_addr().unwrap();
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = server.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0; 4096];
                let _ = stream.read(&mut bytes).unwrap();
                write!(
                    stream,
                    "HTTP/1.1 {status} response\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
            });
            let dsn = format!("http://test@{address}/1").parse().unwrap();
            assert_eq!(
                send_report_bytes(&dsn, b"{}\n", std::time::Duration::from_secs(2))
                    .await
                    .is_ok(),
                status == 200
            );
            worker.join().unwrap();
        }
        let dsn = "http://test@127.0.0.1:1/1".parse().unwrap();
        assert!(
            send_report_bytes(&dsn, b"{}\n", std::time::Duration::from_millis(100))
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn recovery_summary_needs_no_database() {
        let value = serde_json::to_value(summary(None).await.unwrap()).unwrap();
        assert_eq!(value["schemaVersion"], 2);
        assert!(value.get("startupFailure").is_some());
        assert!(value.get("sentryInitialized").is_some());
        assert_eq!(value["pendingIndexJobs"], 0);
    }
}
