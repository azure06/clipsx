//! Host-owned, bounded metadata. Never accepts guest error text or operation data.
use super::diagnostics::{error_reporting_enabled, release_name};
use crate::failure::FailureCode;
use sentry::protocol::{Context, Event, OsContext, Request};
use serde::Serialize;
use std::{
    borrow::Cow,
    collections::VecDeque,
    sync::{LazyLock, Mutex, RwLock},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub app_version: String,
    pub release: String,
    pub environment: String,
    pub os: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    pub arch: String,
    pub webview_engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webview_version: Option<String>,
    pub user_agent: String,
    pub error_reporting_enabled: bool,
}

static RUNTIME: LazyLock<RwLock<RuntimeSnapshot>> =
    LazyLock::new(|| RwLock::new(runtime_snapshot()));

fn runtime_snapshot() -> RuntimeSnapshot {
    let os_version = match sentry::integrations::contexts::utils::os_context() {
        Some(Context::Os(os)) => os.version,
        _ => None,
    };
    RuntimeSnapshot {
        app_version: env!("CARGO_PKG_VERSION").into(),
        release: release_name(),
        environment: if cfg!(debug_assertions) {
            "development"
        } else {
            "production"
        }
        .into(),
        os: std::env::consts::OS.into(),
        os_version,
        arch: std::env::consts::ARCH.into(),
        webview_engine: if cfg!(target_os = "windows") {
            "WebView2"
        } else if cfg!(target_os = "macos") {
            "WKWebView"
        } else {
            "WebKitGTK"
        }
        .into(),
        webview_version: tauri::webview_version()
            .ok()
            .filter(|value| !value.is_empty()),
        user_agent: String::new(),
        error_reporting_enabled: false,
    }
}

fn bounded(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(limit)
        .collect()
}

pub fn bootstrap(user_agent: &str) -> RuntimeSnapshot {
    let mut runtime = RUNTIME.write().unwrap_or_else(|error| error.into_inner());
    if runtime.user_agent.is_empty() {
        runtime.user_agent = bounded(user_agent, 1024);
    }
    let mut snapshot = runtime.clone();
    snapshot.error_reporting_enabled = error_reporting_enabled();
    snapshot
}

pub fn enrich_runtime(event: &mut Event<'_>) {
    let runtime = RUNTIME.read().unwrap_or_else(|error| error.into_inner());
    enrich_with_runtime(event, &runtime);
}

fn enrich_with_runtime(event: &mut Event<'_>, runtime: &RuntimeSnapshot) {
    event.release = Some(Cow::Owned(runtime.release.clone()));
    event.environment = Some(Cow::Owned(runtime.environment.clone()));
    event.contexts.insert(
        "os".into(),
        Context::Os(Box::new(OsContext {
            name: Some(runtime.os.clone()),
            version: runtime.os_version.clone(),
            ..Default::default()
        })),
    );
    for (key, value) in [
        ("app_version", &runtime.app_version),
        ("os", &runtime.os),
        ("arch", &runtime.arch),
        ("webview_engine", &runtime.webview_engine),
    ] {
        event.tags.insert(key.into(), value.clone());
    }
    if let Some(version) = &runtime.webview_version {
        event.tags.insert("webview_version".into(), version.clone());
    }
    let mut context = std::collections::BTreeMap::new();
    context.insert("user_agent".into(), runtime.user_agent.clone().into());
    event
        .contexts
        .insert("webview".into(), Context::Other(context));
    if !runtime.user_agent.is_empty() {
        let mut request = Request::default();
        request
            .headers
            .insert("User-Agent".into(), runtime.user_agent.clone());
        event.request = Some(request);
    }
}

#[derive(Debug, Clone)]
pub struct ExtensionTelemetryContext {
    pub package_id: String,
    pub package_name: String,
    pub package_version: String,
    pub package_sha256: String,
    pub installation_source: String,
    pub contribution_id: String,
    pub contribution_version: String,
    pub contribution_kind: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct FailureState {
    pub count: Option<i64>,
    pub quarantined: bool,
    pub quarantine_transition: bool,
}

pub struct ExecutionTelemetry {
    pub context: ExtensionTelemetryContext,
    pub state: FailureState,
}

#[derive(Clone, Copy, Debug)]
pub enum Stage {
    Validation,
    Detection,
    Availability,
    CompactRendering,
    DetailRendering,
    Execution,
    OutputPersistence,
    CustomViewCreation,
    CustomViewRuntime,
}

impl Stage {
    fn as_str(self) -> &'static str {
        match self {
            Self::Validation => "validation",
            Self::Detection => "detection",
            Self::Availability => "availability",
            Self::CompactRendering => "compact_rendering",
            Self::DetailRendering => "detail_rendering",
            Self::Execution => "execution",
            Self::OutputPersistence => "output_persistence",
            Self::CustomViewCreation => "custom_view_creation",
            Self::CustomViewRuntime => "custom_view_runtime",
        }
    }
}

fn reportable(code: FailureCode) -> bool {
    matches!(
        code,
        FailureCode::ExtensionFailed
            | FailureCode::ExtensionFailedAfterOutputLimit
            | FailureCode::ExtensionTimeout
            | FailureCode::ResourceLimit
            | FailureCode::ExtensionTrap
            | FailureCode::InvalidOutput
            | FailureCode::UnknownFailure
            | FailureCode::ConnectionUnavailable
            | FailureCode::ProviderTimeout
            | FailureCode::ProviderRateLimited
            | FailureCode::ProviderServerError
            | FailureCode::ProviderRejected
            | FailureCode::InvalidResponse
    )
}

fn origin(code: FailureCode) -> &'static str {
    if code.is_guest_fault() {
        "extension"
    } else if matches!(
        code,
        FailureCode::ConnectionUnavailable
            | FailureCode::ProviderTimeout
            | FailureCode::ProviderRateLimited
            | FailureCode::ProviderServerError
            | FailureCode::ProviderRejected
            | FailureCode::InvalidResponse
    ) {
        "provider"
    } else {
        "host"
    }
}

fn extension_event(
    context: &ExtensionTelemetryContext,
    stage: Stage,
    code: FailureCode,
    failures: Option<i64>,
    quarantined: bool,
) -> Event<'static> {
    let mut event = Event {
        message: Some("An extension operation failed".into()),
        level: sentry::Level::Error,
        ..Default::default()
    };
    for (key, value) in [
        ("extension_id", context.package_id.as_str()),
        ("extension_version", &context.package_version),
        ("contribution_id", &context.contribution_id),
        ("contribution_version", &context.contribution_version),
        ("contribution_kind", &context.contribution_kind),
        ("installation_source", &context.installation_source),
        ("stage", stage.as_str()),
        ("error_code", code.as_str()),
        ("failure_origin", origin(code)),
        ("layer", "native"),
    ] {
        if !value.is_empty() {
            event.tags.insert(key.into(), bounded(value, 200));
        }
    }
    event.fingerprint = [
        "clipsx.extension",
        &context.package_id,
        &context.contribution_id,
        stage.as_str(),
        origin(code),
        code.as_str(),
    ]
    .into_iter()
    .map(|value| Cow::Owned(bounded(value, 256)))
    .collect();
    let mut details = std::collections::BTreeMap::new();
    details.insert(
        "package_name".into(),
        bounded(&context.package_name, 256).into(),
    );
    details.insert(
        "package_sha256".into(),
        bounded(&context.package_sha256, 64).into(),
    );
    if let Some(count) = failures {
        details.insert("failure_count".into(), count.into());
        details.insert("quarantined".into(), quarantined.into());
    }
    event
        .contexts
        .insert("extension".into(), Context::Other(details));
    event
}

#[derive(Default)]
struct SuppressionCache(VecDeque<(Vec<String>, Instant)>);

impl SuppressionCache {
    fn accept(&mut self, key: Vec<String>, now: Instant) -> bool {
        self.0
            .retain(|(_, at)| now.duration_since(*at) < Duration::from_secs(60));
        if self.0.iter().any(|(existing, _)| existing == &key) {
            return false;
        }
        if self.0.len() == 256 {
            self.0.pop_front();
        }
        self.0.push_back((key, now));
        true
    }
}

static SUPPRESSION: LazyLock<Mutex<SuppressionCache>> =
    LazyLock::new(|| Mutex::new(SuppressionCache::default()));

fn suppression_key(
    event: &Event<'_>,
    context: &ExtensionTelemetryContext,
    state: FailureState,
) -> Vec<String> {
    let mut key: Vec<String> = event
        .fingerprint
        .iter()
        .map(|part| part.to_string())
        .collect();
    key.extend([
        context.package_version.clone(),
        context.package_sha256.clone(),
        state.quarantine_transition.to_string(),
    ]);
    key
}

pub fn report_extension(
    context: &ExtensionTelemetryContext,
    stage: Stage,
    code: FailureCode,
    state: FailureState,
) {
    if !error_reporting_enabled() || !reportable(code) {
        return;
    }
    let event = extension_event(context, stage, code, state.count, state.quarantined);
    let key = suppression_key(&event, context, state);
    if !SUPPRESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .accept(key, Instant::now())
    {
        return;
    }
    sentry::capture_event(event);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extension(id: &str) -> ExtensionTelemetryContext {
        ExtensionTelemetryContext {
            package_id: id.into(),
            package_name: "Example".into(),
            package_version: "2.0.0".into(),
            package_sha256: "a".repeat(64),
            installation_source: "local".into(),
            contribution_id: format!("{id}/run"),
            contribution_version: "1.0.0".into(),
            contribution_kind: "transformer".into(),
        }
    }

    #[test]
    fn event_context_is_isolated_and_versions_do_not_fragment_issues() {
        let first = extension("example.first");
        let mut updated = first.clone();
        updated.package_version = "3.0.0".into();
        updated.package_sha256 = "b".repeat(64);
        let event = extension_event(
            &first,
            Stage::Execution,
            FailureCode::ExtensionTrap,
            Some(3),
            true,
        );
        let next = extension_event(
            &updated,
            Stage::Execution,
            FailureCode::ExtensionTrap,
            None,
            false,
        );
        let other = extension_event(
            &extension("example.other"),
            Stage::Execution,
            FailureCode::ExtensionTrap,
            None,
            false,
        );
        assert_eq!(event.tags["extension_version"], "2.0.0");
        assert_eq!(event.tags["contribution_version"], "1.0.0");
        assert_eq!(event.tags["failure_origin"], "extension");
        assert_eq!(event.fingerprint, next.fingerprint);
        assert_ne!(event.fingerprint, other.fingerprint);
        assert_eq!(other.tags["extension_id"], "example.other");
        assert_eq!(first.package_version, "2.0.0");
        let mut envelope = sentry::Envelope::new();
        envelope.add_item(event);
        let mut bytes = Vec::new();
        envelope.to_writer(&mut bytes).unwrap();
        let serialized = String::from_utf8(bytes).unwrap();
        assert!(serialized.contains("package_sha256"));
        assert!(!serialized.contains("clip_id"));
        assert!(!serialized.contains("settings"));
        assert!(!serialized.contains("bridge_token"));
    }

    #[test]
    fn metadata_is_bounded_and_unavailable_versions_are_omitted() {
        let ua = bounded(&format!("Mozilla\r\n\0{}", "é".repeat(1200)), 1024);
        assert_eq!(ua.chars().count(), 1024);
        assert!(!ua.chars().any(char::is_control));
        let runtime = RuntimeSnapshot {
            app_version: "1.2.3".into(),
            release: "clipsx-desktop@1.2.3+sha".into(),
            environment: "production".into(),
            os: "windows".into(),
            os_version: None,
            arch: "x86_64".into(),
            webview_engine: "WebView2".into(),
            webview_version: None,
            user_agent: ua.clone(),
            error_reporting_enabled: false,
        };
        let mut event = Event::default();
        enrich_with_runtime(&mut event, &runtime);
        assert_eq!(event.tags["app_version"], "1.2.3");
        assert!(!event.tags.contains_key("webview_version"));
        let request = event.request.unwrap();
        assert_eq!(request.headers.len(), 1);
        assert_eq!(request.headers["User-Agent"], ua);
        assert!(request.url.is_none());
        assert!(request.data.is_none());
        let json = serde_json::to_value(runtime).unwrap();
        assert!(json.get("osVersion").is_none());
        assert!(json.get("webviewVersion").is_none());
    }

    #[test]
    fn only_unexpected_and_terminal_codes_are_reportable() {
        for code in [
            FailureCode::ProviderCancelled,
            FailureCode::StaleContext,
            FailureCode::UnsupportedInput,
            FailureCode::InvalidInput,
            FailureCode::InvalidParameters,
            FailureCode::InputLimit,
            FailureCode::ContextOverflow,
            FailureCode::PermissionRequired,
            FailureCode::ProviderNotConfigured,
            FailureCode::ProviderDisabled,
            FailureCode::ProviderConfiguration,
            FailureCode::ModelUnavailable,
        ] {
            assert!(!reportable(code), "{code:?}");
        }
        assert!(reportable(FailureCode::ExtensionTimeout));
        assert!(reportable(FailureCode::InvalidOutput));
        assert!(reportable(FailureCode::UnknownFailure));
        assert!(reportable(FailureCode::ProviderTimeout));
        assert_eq!(origin(FailureCode::ProviderTimeout), "provider");
        assert_eq!(origin(FailureCode::UnknownFailure), "host");
    }

    #[test]
    fn suppression_expires_is_bounded_and_allows_version_and_quarantine_changes() {
        let mut cache = SuppressionCache::default();
        let now = Instant::now();
        let context = extension("example.tool");
        let event = extension_event(
            &context,
            Stage::Execution,
            FailureCode::ExtensionTrap,
            None,
            false,
        );
        let key = suppression_key(&event, &context, FailureState::default());
        assert!(cache.accept(key.clone(), now));
        assert!(!cache.accept(key.clone(), now + Duration::from_secs(59)));
        let quarantine = suppression_key(
            &event,
            &context,
            FailureState {
                quarantine_transition: true,
                ..Default::default()
            },
        );
        assert!(cache.accept(quarantine.clone(), now));
        assert!(!cache.accept(quarantine, now));
        let mut updated = context.clone();
        updated.package_version = "3.0.0".into();
        let version = suppression_key(&event, &updated, FailureState::default());
        assert!(cache.accept(version, now));
        updated = context.clone();
        updated.package_sha256 = "b".repeat(64);
        assert!(cache.accept(
            suppression_key(&event, &updated, FailureState::default()),
            now
        ));
        assert!(cache.accept(key, now + Duration::from_secs(60)));
        for index in 0..300 {
            assert!(cache.accept(vec![index.to_string()], now + Duration::from_secs(60)));
        }
        assert_eq!(cache.0.len(), 256);
    }
}
