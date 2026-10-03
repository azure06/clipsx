use crate::failure::{FailureCode, OperationFailure};
use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use bindings::Extension;
use tokio::time::timeout;
use wasmtime::{
    component::{Component, HasSelf, Linker},
    Cache, CacheConfig, Config, Engine, Store, StoreLimits, StoreLimitsBuilder,
};

#[allow(clippy::too_many_arguments)]
mod bindings {
    wasmtime::component::bindgen!({
        path: "wit",
        world: "extension",
        imports: { default: async },
        exports: { default: async },
    });
}

const MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const TABLE_ELEMENTS_LIMIT: usize = 10_000;
// wit-component's no-WASI wrapper for this world uses a bounded set of core
// instances and canonical-ABI tables around one guest memory.
const CORE_INSTANCE_LIMIT: usize = 5;
const CORE_TABLE_LIMIT: usize = 2;
const CORE_MEMORY_LIMIT: usize = 1;
const DETECT_RENDER_FUEL: u64 = 10_000_000;
const TRANSFORM_FUEL: u64 = 50_000_000;
const LOCAL_FUEL: u64 = u64::MAX;
const MIB: usize = 1024 * 1024;
const HOSTCALL_TRANSFER_LIMIT: usize = 16 * MIB;

#[derive(Debug, Clone)]
pub enum ExtensionContent {
    Text(String),
    Binary(Vec<u8>),
    Files(Vec<String>),
}

#[derive(Debug, Clone)]
pub struct ExtensionRepresentation {
    pub format_key: String,
    pub mime_type: Option<String>,
    pub storage_kind: String,
    pub content: ExtensionContent,
}

#[derive(Debug, Clone)]
pub struct ExtensionFacet {
    pub id: String,
    pub payload_json: String,
}

#[derive(Debug, Clone)]
pub enum ExtensionRenderModel {
    Text(String),
    Code {
        language: Option<String>,
        text: String,
    },
    Markdown(String),
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Tree(String),
    KeyValue(Vec<(String, String)>),
    Image,
    Error(String),
}

#[derive(Debug, Clone)]
pub enum ExtensionLeadingVisual {
    None,
    HostIcon(String),
    Swatch {
        red: u8,
        green: u8,
        blue: u8,
        alpha: u8,
    },
    InputThumbnail,
    Monogram(String),
}

#[derive(Debug, Clone)]
pub struct ExtensionCompactModel {
    pub leading: ExtensionLeadingVisual,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub badge: Option<String>,
    pub accessibility_label: String,
}

#[derive(Debug, Clone)]
pub struct ExtensionOutputRepresentation {
    pub id: String,
    pub format_key: String,
    pub mime_type: String,
    pub content: ExtensionContent,
}

#[derive(Debug, Clone)]
pub enum OperationAvailability {
    Hidden,
    Disabled(String),
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepKind {
    Read,
    ModelCall,
    Write,
}

#[derive(Debug, Clone)]
pub struct StepCall {
    pub id: String,
    pub kind: StepKind,
    pub request_json: String,
    pub state_json: String,
}

#[derive(Debug, Clone)]
pub struct OperationComplete {
    pub outputs: Vec<ExtensionOutputRepresentation>,
    pub view_json: Option<String>,
    pub state_writes_json: Option<String>,
}

#[derive(Debug, Clone)]
pub enum OperationProgress {
    Skip(String),
    Call(StepCall),
    Complete(OperationComplete),
}

#[derive(Debug, Clone)]
pub enum ExtensionActionResult {
    OpenHttpsUrl(String),
    Notification { level: String, message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtensionActionState {
    Hidden,
    Disabled(String),
    Enabled,
}

struct StoreData {
    limits: StoreLimits,
    broker: Option<RuntimeBrokerContext>,
}

#[derive(Clone)]
pub struct RuntimeBrokerContext {
    pub repo: crate::history::HistoryRepository,
    pub http_permissions: Vec<super::manifest::HttpPermission>,
    pub write_permissions: Vec<super::manifest::HttpPermission>,
    pub extension_id: String,
    pub package_sha256: String,
    pub injected_headers: BTreeMap<String, BTreeMap<String, String>>,
    pub protected_secrets: Vec<Vec<u8>>,
    pub generation_allowed: bool,
    pub generation_cancellation: crate::providers::contracts::generation::GenerationCancellation,
    pub invocation_failure: Arc<tokio::sync::Mutex<Option<OperationFailure>>>,
    pub package_id: String,
    pub state_keys: Vec<String>,
    pub state_schemas: BTreeMap<String, serde_json::Value>,
    pub state_allowed: bool,
    pub staged_state: Option<Arc<tokio::sync::Mutex<StagedPackageState>>>,
}

pub(crate) async fn require_live_grant(
    context: &RuntimeBrokerContext,
    kind: &str,
    value: &str,
) -> std::result::Result<(), OperationFailure> {
    let granted: Option<i64> = sqlx::query_scalar("SELECT 1 FROM extension_permission_grants g JOIN extension_installs i ON i.id=g.extension_id WHERE g.extension_id=? AND g.package_sha256=? AND g.permission_kind=? AND g.permission_value=? AND i.enabled=1 AND i.sha256=g.package_sha256")
        .bind(&context.extension_id)
        .bind(&context.package_sha256)
        .bind(kind)
        .bind(value)
        .fetch_optional(&context.repo.pool)
        .await
        .map_err(|_| FailureCode::UnknownFailure.failure())?;
    if granted.is_none() {
        let failure = FailureCode::PermissionRequired.failure();
        *context.invocation_failure.lock().await = Some(failure);
        return Err(failure);
    }
    Ok(())
}

#[derive(Default)]
pub struct StagedPackageState {
    pub snapshot: BTreeMap<String, String>,
    pub writes: BTreeMap<String, Option<String>>,
}

impl bindings::clipsx::extension::broker::Host for StoreData {
    async fn https(
        &mut self,
        request: bindings::clipsx::extension::broker::HttpRequest,
    ) -> std::result::Result<bindings::clipsx::extension::broker::HttpResponse, String> {
        let context = self
            .broker
            .clone()
            .ok_or_else(|| "broker capability is unavailable for this invocation".to_string())?;
        let parsed = url::Url::parse(&request.url)
            .map_err(|_| "extension HTTPS URL is invalid".to_string())?;
        let permission = context
            .http_permissions
            .iter()
            .find(|permission| {
                url::Url::parse(&permission.origin)
                    .map(|declared| declared.origin() == parsed.origin())
                    .unwrap_or(false)
            })
            .ok_or_else(|| "extension HTTPS origin is not declared".to_string())?;
        if !matches!(request.method.as_str(), "GET" | "HEAD") {
            return Err(
                "direct mutating HTTPS is unavailable; use a durable operation step".into(),
            );
        }
        require_live_grant(&context, "http", &permission.origin)
            .await
            .map_err(|failure| failure.to_string())?;
        let headers = request
            .headers
            .into_iter()
            .map(|header| (header.name, header.value))
            .collect();
        let response = super::broker::https(
            permission,
            super::BrokerHttpRequest {
                url: request.url,
                method: request.method,
                headers,
                body: request.body,
            },
            context
                .injected_headers
                .get(&permission.origin)
                .cloned()
                .unwrap_or_default(),
        )
        .await
        .map_err(|error| bounded_error(&error))?;
        if contains_protected_secret(&response.body, &context.protected_secrets) {
            return Err("extension HTTPS response reflected a protected credential".into());
        }
        Ok(bindings::clipsx::extension::broker::HttpResponse {
            status: response.status,
            content_type: response.content_type,
            body: response.body,
        })
    }

    async fn generate_text(
        &mut self,
        request: bindings::clipsx::extension::broker::GenerationRequest,
    ) -> std::result::Result<bindings::clipsx::extension::broker::GenerationResponse, String> {
        let context = self
            .broker
            .clone()
            .filter(|context| context.generation_allowed)
            .ok_or_else(|| "generation.text is unavailable for this invocation".to_string())?;
        require_live_grant(&context, "provider", "generation.text")
            .await
            .map_err(|failure| failure.to_string())?;
        if request.messages.is_empty()
            || request.messages.len() > 16
            || !(1..=4096).contains(&request.max_output_tokens)
            || request
                .messages
                .iter()
                .map(|message| message.content.len())
                .sum::<usize>()
                > MIB
        {
            let failure = FailureCode::InputLimit.failure();
            *context.invocation_failure.lock().await = Some(failure);
            return Err(failure.to_string());
        }
        let messages = request
            .messages
            .into_iter()
            .map(
                |message| crate::providers::contracts::generation::GenerationMessage {
                    role: match message.role {
                        bindings::clipsx::extension::broker::GenerationRole::System => {
                            crate::providers::contracts::generation::GenerationRole::System
                        }
                        bindings::clipsx::extension::broker::GenerationRole::User => {
                            crate::providers::contracts::generation::GenerationRole::User
                        }
                        bindings::clipsx::extension::broker::GenerationRole::Assistant => {
                            crate::providers::contracts::generation::GenerationRole::Assistant
                        }
                    },
                    content: message.content,
                },
            )
            .collect();
        let response = crate::providers::generation::generate_stream(
            &context.repo,
            messages,
            request.max_output_tokens,
            &context.generation_cancellation,
            &|_| Ok(()),
        )
        .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let failure = OperationFailure::from_error(&error);
                *context.invocation_failure.lock().await = Some(failure);
                return Err(failure.to_string());
            }
        };
        Ok(bindings::clipsx::extension::broker::GenerationResponse {
            text: response.text,
            completion_reason: match response.completion_reason {
                crate::providers::contracts::generation::GenerationCompletionReason::Stop => {
                    bindings::clipsx::extension::broker::CompletionReason::Stop
                }
                crate::providers::contracts::generation::GenerationCompletionReason::Length => {
                    bindings::clipsx::extension::broker::CompletionReason::Length
                }
                crate::providers::contracts::generation::GenerationCompletionReason::Other(_) => {
                    bindings::clipsx::extension::broker::CompletionReason::Other
                }
            },
        })
    }

    async fn state_get(&mut self, key: String) -> std::result::Result<Option<String>, String> {
        let context = state_context(&self.broker, &key)?;
        if let Some(stage) = &context.staged_state {
            let stage = stage.lock().await;
            return Ok(stage
                .writes
                .get(&key)
                .cloned()
                .unwrap_or_else(|| stage.snapshot.get(&key).cloned()));
        }
        sqlx::query_scalar(
            "SELECT value_json FROM extension_package_state WHERE package_id=? AND state_key=?",
        )
        .bind(&context.package_id)
        .bind(key)
        .fetch_optional(&context.repo.pool)
        .await
        .map_err(|error| bounded_error(&error.into()))
    }

    async fn state_set(
        &mut self,
        key: String,
        value_json: String,
    ) -> std::result::Result<(), String> {
        let context = state_context(&self.broker, &key)?;
        let parsed = serde_json::from_str::<serde_json::Value>(&value_json);
        if value_json.is_empty() || value_json.len() > 8192 || parsed.is_err() {
            return Err("extension state value is invalid".into());
        }
        let schema = context
            .state_schemas
            .get(&key)
            .ok_or_else(|| "package state key is undeclared".to_string())?;
        if super::manifest::validate_state_value(schema, &parsed.unwrap()).is_err() {
            return Err("extension state value does not match its schema".into());
        }
        if let Some(stage) = &context.staged_state {
            let mut stage = stage.lock().await;
            let mut effective = stage.snapshot.clone();
            for (state_key, value) in &stage.writes {
                if let Some(value) = value {
                    effective.insert(state_key.clone(), value.clone());
                } else {
                    effective.remove(state_key);
                }
            }
            effective.insert(key.clone(), value_json.clone());
            let bytes = effective
                .iter()
                .map(|(state_key, value)| state_key.len() + value.len())
                .sum::<usize>();
            if effective.len() > 64 || bytes > 128 * 1024 {
                return Err("extension state quota exceeded".into());
            }
            stage.writes.insert(key, Some(value_json));
            return Ok(());
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM extension_package_state WHERE package_id=? AND state_key<>?",
        )
        .bind(&context.package_id)
        .bind(&key)
        .fetch_one(&context.repo.pool)
        .await
        .map_err(|error| error.to_string())?;
        let bytes: i64 = sqlx::query_scalar("SELECT coalesce(sum(byte_length),0) FROM extension_package_state WHERE package_id=? AND state_key<>?")
            .bind(&context.package_id).bind(&key).fetch_one(&context.repo.pool).await.map_err(|error| error.to_string())?;
        if count >= 64 || bytes + value_json.len() as i64 > 128 * 1024 {
            return Err("extension state quota exceeded".into());
        }
        let mut tx = context
            .repo
            .pool
            .begin()
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO extension_package_revisions(package_id,state_revision,updated_at) VALUES(?,1,?) ON CONFLICT(package_id) DO UPDATE SET state_revision=state_revision+1,updated_at=excluded.updated_at")
            .bind(&context.package_id).bind(crate::history::now_ms()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
        let revision: i64 = sqlx::query_scalar(
            "SELECT state_revision FROM extension_package_revisions WHERE package_id=?",
        )
        .bind(&context.package_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO extension_package_state(package_id,state_key,value_json,byte_length,revision,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(package_id,state_key) DO UPDATE SET value_json=excluded.value_json,byte_length=excluded.byte_length,revision=excluded.revision,updated_at=excluded.updated_at")
            .bind(&context.package_id).bind(key).bind(&value_json).bind(value_json.len() as i64).bind(revision).bind(crate::history::now_ms()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
        tx.commit().await.map_err(|error| error.to_string())
    }

    async fn state_delete(&mut self, key: String) -> std::result::Result<(), String> {
        let context = state_context(&self.broker, &key)?;
        if let Some(stage) = &context.staged_state {
            stage.lock().await.writes.insert(key, None);
            return Ok(());
        }
        let mut tx = context
            .repo
            .pool
            .begin()
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM extension_package_state WHERE package_id=? AND state_key=?")
            .bind(&context.package_id)
            .bind(key)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO extension_package_revisions(package_id,state_revision,updated_at) VALUES(?,1,?) ON CONFLICT(package_id) DO UPDATE SET state_revision=extension_package_revisions.state_revision+1,updated_at=excluded.updated_at")
            .bind(&context.package_id).bind(crate::history::now_ms()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
        tx.commit().await.map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn state_context(
    context: &Option<RuntimeBrokerContext>,
    key: &str,
) -> std::result::Result<RuntimeBrokerContext, String> {
    context
        .clone()
        .filter(|context| {
            context.state_allowed && context.state_keys.iter().any(|item| item == key)
        })
        .ok_or_else(|| "package state is unavailable for this key".into())
}

fn bounded_error(error: &anyhow::Error) -> String {
    error.to_string().chars().take(512).collect()
}

fn contains_protected_secret(body: &[u8], secrets: &[Vec<u8>]) -> bool {
    secrets.iter().any(|secret| {
        !secret.is_empty()
            && body
                .windows(secret.len())
                .any(|candidate| candidate == secret.as_slice())
    })
}

/// Component runtime with an empty linker. An extension gets no WASI or
/// application imports: a component requiring one cannot be instantiated.
#[derive(Clone)]
pub struct ExtensionRuntime {
    engine: Engine,
    components: Arc<Mutex<HashMap<String, Component>>>,
    preparation: Arc<tokio::sync::Mutex<()>>,
    cache: Option<Cache>,
    #[cfg(test)]
    pub(super) detection_calls: Arc<std::sync::atomic::AtomicUsize>,
}

impl ExtensionRuntime {
    pub fn new(cache_directory: &Path) -> Result<Self> {
        let mut config = Config::new();
        config.wasm_component_model(true);
        config.consume_fuel(true);
        config.epoch_interruption(true);
        config.max_wasm_stack(2 * 1024 * 1024);
        let cache = (|| -> Result<Cache> {
            std::fs::create_dir_all(cache_directory)?;
            let mut cache_config = CacheConfig::new();
            cache_config.with_directory(cache_directory);
            Cache::new(cache_config).map_err(wasmtime_error)
        })()
        .ok();
        if cache.is_none() {
            crate::diagnostic!("extension.compilation.cache.unavailable");
        }
        config.cache(cache.clone());
        let engine = Engine::new(&config).map_err(wasmtime_error)?;
        let ticker = engine.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(10));
            loop {
                interval.tick().await;
                ticker.increment_epoch();
            }
        });
        Ok(Self {
            engine,
            components: Arc::new(Mutex::new(HashMap::new())),
            preparation: Arc::new(tokio::sync::Mutex::new(())),
            cache,
            #[cfg(test)]
            detection_calls: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        })
    }

    pub async fn validate_component(&self, sha256: &str, path: &Path) -> Result<()> {
        let guard = self.preparation.clone().lock_owned().await;
        if self.component(sha256).is_some() {
            return Ok(());
        }
        crate::diagnostic!("extension.component.compile.begin");
        let started = Instant::now();
        let cache_hits = self.cache.as_ref().map_or(0, Cache::cache_hits);
        let bytes = tokio::fs::read(path)
            .await
            .context("unable to read extension component")?;
        if bytes.len() > 8 * 1024 * 1024 {
            bail!("extension component exceeds 8 MiB");
        }
        let engine = self.engine.clone();
        // Keep the compilation permit in the blocking task if its caller is cancelled.
        let (component, _guard) =
            tokio::task::spawn_blocking(move || (Component::new(&engine, bytes), guard))
                .await
                .context("extension compilation task failed")?;
        let component = component
            .map_err(wasmtime_error)
            .context("extension component is invalid")
            .inspect_err(|error| {
                crate::app::diagnostics::operational_error(
                    "extension.component.compile.failed",
                    error,
                )
            })?;
        crate::diagnostic!("extension.component.instantiate.begin");
        self.instantiate(
            component.clone(),
            DETECT_RENDER_FUEL,
            Duration::from_millis(250),
        )
        .await
        .inspect_err(|error| {
            crate::app::diagnostics::operational_error(
                "extension.component.instantiate.failed",
                error,
            )
        })?;
        self.components
            .lock()
            .expect("extension component cache poisoned")
            .insert(sha256.into(), component);
        crate::diagnostic!(
            "[PERF] extension-component-prepare count=1 cache_hit={} duration_ms={}",
            self.cache
                .as_ref()
                .is_some_and(|cache| cache.cache_hits() > cache_hits),
            started.elapsed().as_millis()
        );
        Ok(())
    }

    pub fn component(&self, sha256: &str) -> Option<Component> {
        self.components
            .lock()
            .expect("extension component cache poisoned")
            .get(sha256)
            .cloned()
    }

    pub async fn detect(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
    ) -> Result<Vec<ExtensionFacet>> {
        #[cfg(test)]
        self.detection_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let deadline = local_deadline(&input, 100, 750);
        let (mut store, instance) = self
            .binding_instance(sha256, LOCAL_FUEL, deadline, None)
            .await?;
        let result = timeout(
            deadline,
            instance.call_detect(&mut store, contribution_id, &to_wit_representation(input)),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        result
            .map(|facets| {
                facets
                    .into_iter()
                    .map(|facet| ExtensionFacet {
                        id: facet.id,
                        payload_json: facet.payload_json,
                    })
                    .collect()
            })
            .map_err(guest_error)
    }

    pub async fn render_detail(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        facet: Option<ExtensionFacet>,
    ) -> Result<ExtensionRenderModel> {
        let deadline = local_deadline(&input, 250, 1_000);
        let (mut store, instance) = self
            .binding_instance(sha256, LOCAL_FUEL, deadline, None)
            .await?;
        let result = timeout(
            deadline,
            instance.call_render_detail(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
            ),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        result.map(from_wit_render_model).map_err(guest_error)
    }

    pub async fn render_compact(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        facet: Option<ExtensionFacet>,
    ) -> Result<ExtensionCompactModel> {
        let deadline = local_deadline(&input, 100, 750);
        let (mut store, instance) = self
            .binding_instance(sha256, LOCAL_FUEL, deadline, None)
            .await?;
        let result = timeout(
            deadline,
            instance.call_render_compact(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
            ),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        result.map(from_wit_compact_model).map_err(guest_error)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn advance(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        context_json: String,
        parameters_json: String,
        state_json: String,
        previous_response_json: Option<String>,
    ) -> Result<OperationProgress> {
        let deadline = local_deadline(&input, 500, 2_000);
        let (mut store, instance) = self
            .binding_instance(sha256, TRANSFORM_FUEL, deadline, None)
            .await?;
        let result = timeout(
            deadline,
            instance.call_advance(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                &context_json,
                &parameters_json,
                &state_json,
                previous_response_json.as_deref(),
            ),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        use bindings::clipsx::extension::types::{
            OperationProgress as WitProgress, StepKind as WitKind,
        };
        Ok(match result.map_err(guest_error)? {
            WitProgress::Skip(reason) => OperationProgress::Skip(reason),
            WitProgress::Call(call) => OperationProgress::Call(StepCall {
                id: call.id,
                kind: match call.kind {
                    WitKind::Read => StepKind::Read,
                    WitKind::ModelCall => StepKind::ModelCall,
                    WitKind::Write => StepKind::Write,
                },
                request_json: call.request_json,
                state_json: call.state_json,
            }),
            WitProgress::Complete(value) => OperationProgress::Complete(OperationComplete {
                outputs: value.outputs.into_iter().map(from_wit_output).collect(),
                view_json: value.view_json,
                state_writes_json: value.state_writes_json,
            }),
        })
    }

    pub async fn assess(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        context_json: String,
        parameters_json: String,
    ) -> Result<OperationAvailability> {
        let deadline = local_deadline(&input, 100, 500);
        let (mut store, instance) = self
            .binding_instance(sha256, LOCAL_FUEL, deadline, None)
            .await?;
        let result = timeout(
            deadline,
            instance.call_assess(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                &context_json,
                &parameters_json,
            ),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        use bindings::clipsx::extension::types::OperationAvailability as WitAvailability;
        Ok(match result.map_err(guest_error)? {
            WitAvailability::Hidden => OperationAvailability::Hidden,
            WitAvailability::Disabled(reason) => OperationAvailability::Disabled(reason),
            WitAvailability::Ready => OperationAvailability::Ready,
        })
    }

    pub async fn run_action(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        facet: Option<ExtensionFacet>,
        parameters_json: String,
        broker: Option<RuntimeBrokerContext>,
    ) -> Result<ExtensionActionResult> {
        let capability_backed = broker.is_some();
        let deadline = if capability_backed {
            Duration::from_secs(125)
        } else {
            local_deadline(&input, 500, 2_000)
        };
        let fuel = if capability_backed {
            TRANSFORM_FUEL
        } else {
            LOCAL_FUEL
        };
        let invocation_failure = broker
            .as_ref()
            .map(|context| context.invocation_failure.clone());
        let (mut store, instance) = self
            .binding_instance(sha256, fuel, deadline, broker)
            .await?;
        let result = timeout(
            deadline,
            instance.call_run_action(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
                &parameters_json,
            ),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        match result {
            Ok(result) => Ok(from_wit_action_result(result)),
            Err(error) => {
                if let Some(failure) = invocation_failure {
                    if let Some(failure) = *failure.lock().await {
                        return Err(failure.into());
                    }
                }
                Err(guest_error(error))
            }
        }
    }

    pub async fn action_state(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        facet: Option<ExtensionFacet>,
        settings_json: String,
    ) -> Result<ExtensionActionState> {
        let deadline = local_deadline(&input, 100, 750);
        let (mut store, instance) = self
            .binding_instance(sha256, LOCAL_FUEL, deadline, None)
            .await?;
        let result = timeout(
            deadline,
            instance.call_action_state(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
                &settings_json,
            ),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        result.map(from_wit_action_state).map_err(guest_error)
    }

    async fn binding_instance(
        &self,
        sha256: &str,
        fuel: u64,
        deadline: Duration,
        broker: Option<RuntimeBrokerContext>,
    ) -> Result<(Store<StoreData>, Extension)> {
        let component = self
            .component(sha256)
            .context("extension component is not loaded")?;
        let mut store = new_store(&self.engine, fuel, broker)?;
        let mut linker = Linker::<StoreData>::new(&self.engine);
        bindings::clipsx::extension::broker::add_to_linker::<StoreData, HasSelf<StoreData>>(
            &mut linker,
            |state| state,
        )
        .map_err(wasmtime_error)?;
        let instance = timeout(
            deadline,
            Extension::instantiate_async(&mut store, &component, &linker),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        Ok((store, instance))
    }

    async fn instantiate(&self, component: Component, fuel: u64, deadline: Duration) -> Result<()> {
        let mut store = new_store(&self.engine, fuel, None)?;
        let mut linker = Linker::<StoreData>::new(&self.engine);
        bindings::clipsx::extension::broker::add_to_linker::<StoreData, HasSelf<StoreData>>(
            &mut linker,
            |state| state,
        )
        .map_err(wasmtime_error)?;
        timeout(
            deadline,
            Extension::instantiate_async(&mut store, &component, &linker),
        )
        .await
        .map_err(|_| FailureCode::ExtensionTimeout.failure())?
        .map_err(wasmtime_error)?;
        Ok(())
    }
}

fn new_store(
    engine: &Engine,
    fuel: u64,
    broker: Option<RuntimeBrokerContext>,
) -> Result<Store<StoreData>> {
    let mut store = Store::new(
        engine,
        StoreData {
            limits: StoreLimitsBuilder::new()
                .memory_size(MEMORY_LIMIT)
                .table_elements(TABLE_ELEMENTS_LIMIT)
                .memories(CORE_MEMORY_LIMIT)
                .tables(CORE_TABLE_LIMIT)
                .instances(CORE_INSTANCE_LIMIT)
                .trap_on_grow_failure(true)
                .build(),
            broker,
        },
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(fuel).map_err(wasmtime_error)?;
    // Guest output is lifted through one hostcall. Keep this above the 14 MiB
    // output boundary so expanding transforms such as Base64 can consume the
    // full 10 MiB input allowance without exhausting canonical-ABI fuel.
    store.set_hostcall_fuel(HOSTCALL_TRANSFER_LIMIT);
    store.set_epoch_deadline(1);
    // Yield every epoch so Tokio can enforce the invocation's outer timeout.
    // Trapping here would expire while an async broker call is legitimately
    // waiting and then kill the guest as soon as that host call returns.
    store.epoch_deadline_async_yield_and_update(1);
    Ok(store)
}

fn local_deadline(input: &ExtensionRepresentation, baseline_ms: u64, maximum_ms: u64) -> Duration {
    let bytes = match &input.content {
        ExtensionContent::Text(value) => value.len(),
        ExtensionContent::Binary(value) => value.len(),
        ExtensionContent::Files(values) => values.iter().map(String::len).sum(),
    };
    let size_allowance = u64::try_from(bytes.div_ceil(MIB))
        .unwrap_or(u64::MAX)
        .saturating_mul(50);
    Duration::from_millis(baseline_ms.saturating_add(size_allowance).min(maximum_ms))
}

fn guest_error(error: bindings::clipsx::extension::types::GuestError) -> anyhow::Error {
    use bindings::clipsx::extension::types::GuestErrorCode;
    match error.code {
        GuestErrorCode::Unsupported => FailureCode::UnsupportedInput,
        GuestErrorCode::InvalidInput => FailureCode::InvalidInput,
        GuestErrorCode::InvalidParameters => FailureCode::InvalidParameters,
        GuestErrorCode::Failed => FailureCode::ExtensionFailed,
    }
    .failure()
    .into()
}

fn to_wit_representation(
    value: ExtensionRepresentation,
) -> bindings::clipsx::extension::types::Representation {
    use bindings::clipsx::extension::types::{Content, Representation};
    Representation {
        format_key: value.format_key,
        mime_type: value.mime_type,
        storage_kind: value.storage_kind,
        content: match value.content {
            ExtensionContent::Text(value) => Content::Text(value),
            ExtensionContent::Binary(value) => Content::Binary(value),
            ExtensionContent::Files(value) => Content::Files(value),
        },
    }
}

fn to_wit_facet(value: ExtensionFacet) -> bindings::clipsx::extension::types::Facet {
    bindings::clipsx::extension::types::Facet {
        id: value.id,
        payload_json: value.payload_json,
    }
}

fn from_wit_output(
    value: bindings::clipsx::extension::types::OutputRepresentation,
) -> ExtensionOutputRepresentation {
    ExtensionOutputRepresentation {
        id: value.id,
        format_key: value.format_key,
        mime_type: value.mime_type,
        content: match value.content {
            bindings::clipsx::extension::types::OutputContent::Text(value) => {
                ExtensionContent::Text(value)
            }
            bindings::clipsx::extension::types::OutputContent::Binary(value) => {
                ExtensionContent::Binary(value)
            }
        },
    }
}

fn from_wit_render_model(
    value: bindings::clipsx::extension::types::RenderModel,
) -> ExtensionRenderModel {
    use bindings::clipsx::extension::types::RenderModel;
    match value {
        RenderModel::Text(value) => ExtensionRenderModel::Text(value),
        RenderModel::Code(value) => ExtensionRenderModel::Code {
            language: value.language,
            text: value.text,
        },
        RenderModel::Markdown(value) => ExtensionRenderModel::Markdown(value),
        RenderModel::Table(value) => ExtensionRenderModel::Table {
            columns: value.columns,
            rows: value.rows,
        },
        RenderModel::Tree(value) => ExtensionRenderModel::Tree(value),
        RenderModel::KeyValue(value) => ExtensionRenderModel::KeyValue(
            value
                .into_iter()
                .map(|entry| (entry.key, entry.value))
                .collect(),
        ),
        RenderModel::Image(_) => ExtensionRenderModel::Image,
        RenderModel::Error(value) => ExtensionRenderModel::Error(value),
    }
}

fn from_wit_compact_model(
    value: bindings::clipsx::extension::types::CompactModel,
) -> ExtensionCompactModel {
    ExtensionCompactModel {
        leading: from_wit_leading(value.leading),
        title: value.title,
        subtitle: value.subtitle,
        badge: value.badge,
        accessibility_label: value.accessibility_label,
    }
}

fn from_wit_leading(
    value: bindings::clipsx::extension::types::LeadingVisual,
) -> ExtensionLeadingVisual {
    use bindings::clipsx::extension::types::LeadingVisual;
    match value {
        LeadingVisual::None => ExtensionLeadingVisual::None,
        LeadingVisual::HostIcon(value) => ExtensionLeadingVisual::HostIcon(value),
        LeadingVisual::Swatch(value) => ExtensionLeadingVisual::Swatch {
            red: value.red,
            green: value.green,
            blue: value.blue,
            alpha: value.alpha,
        },
        LeadingVisual::InputThumbnail => ExtensionLeadingVisual::InputThumbnail,
        LeadingVisual::Monogram(value) => ExtensionLeadingVisual::Monogram(value),
    }
}

fn from_wit_action_result(
    value: bindings::clipsx::extension::types::ActionResult,
) -> ExtensionActionResult {
    use bindings::clipsx::extension::types::ActionResult;
    match value {
        ActionResult::OpenHttpsUrl(url) => ExtensionActionResult::OpenHttpsUrl(url),
        ActionResult::Notification((level, message)) => {
            ExtensionActionResult::Notification { level, message }
        }
    }
}

fn from_wit_action_state(
    value: bindings::clipsx::extension::types::ActionState,
) -> ExtensionActionState {
    use bindings::clipsx::extension::types::ActionState;
    match value {
        ActionState::Hidden => ExtensionActionState::Hidden,
        ActionState::Disabled(reason) => ExtensionActionState::Disabled(reason),
        ActionState::Enabled => ExtensionActionState::Enabled,
    }
}

fn wasmtime_error(error: wasmtime::Error) -> anyhow::Error {
    let code = match error.downcast_ref::<wasmtime::Trap>() {
        Some(wasmtime::Trap::OutOfFuel | wasmtime::Trap::StackOverflow) => {
            FailureCode::ResourceLimit
        }
        Some(wasmtime::Trap::Interrupt) => FailureCode::ExtensionTimeout,
        _ => FailureCode::ExtensionTrap,
    };
    code.failure().into()
}

pub(super) fn runtime_error_code(error: &anyhow::Error) -> &'static str {
    OperationFailure::from_error(error).code.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn component_preparation_is_serialized_and_cached_across_engines() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("component.wasm");
        std::fs::write(&path, super::super::test_component::bytes()).unwrap();
        let cache_path = temp.path().join("cache");
        let runtime = ExtensionRuntime::new(&cache_path).unwrap();
        let (first, second, third) = tokio::join!(
            runtime.validate_component("fixture", &path),
            runtime.validate_component("fixture", &path),
            runtime.validate_component("fixture", &path),
        );
        first.unwrap();
        second.unwrap();
        third.unwrap();
        assert_eq!(runtime.cache.as_ref().unwrap().cache_misses(), 1);
        let reopened = ExtensionRuntime::new(&cache_path).unwrap();
        reopened.validate_component("fixture", &path).await.unwrap();
        assert_eq!(reopened.cache.as_ref().unwrap().cache_hits(), 1);
        assert_eq!(reopened.cache.as_ref().unwrap().cache_misses(), 0);
    }

    #[tokio::test]
    async fn unavailable_disk_cache_still_prepares_valid_components() {
        let temp = tempfile::tempdir().unwrap();
        let cache_path = temp.path().join("not-a-directory");
        std::fs::write(&cache_path, b"file").unwrap();
        let runtime = ExtensionRuntime::new(&cache_path).unwrap();
        assert!(runtime.cache.is_none());
        let path = temp.path().join("component.wasm");
        std::fs::write(&path, super::super::test_component::bytes()).unwrap();
        runtime.validate_component("fixture", &path).await.unwrap();
        std::fs::write(&path, b"invalid component").unwrap();
        assert!(runtime.validate_component("invalid", &path).await.is_err());
        assert!(runtime.component("invalid").is_none());
    }

    #[test]
    fn credential_reflection_check_is_exact_and_ignores_empty_values() {
        let secrets = vec![Vec::new(), b"token-value".to_vec()];
        assert!(contains_protected_secret(
            b"{\"authorization\":\"token-value\"}",
            &secrets
        ));
        assert!(!contains_protected_secret(b"safe response", &secrets));
    }

    #[test]
    fn local_deadlines_scale_with_input_and_remain_capped() {
        let input = |bytes: usize| ExtensionRepresentation {
            format_key: "mime:text/plain".into(),
            mime_type: Some("text/plain".into()),
            storage_kind: "text".into(),
            content: ExtensionContent::Text("x".repeat(bytes)),
        };
        assert_eq!(
            local_deadline(&input(1), 100, 750),
            Duration::from_millis(150)
        );
        assert_eq!(
            local_deadline(&input(300 * 1024), 100, 750),
            Duration::from_millis(150)
        );
        assert_eq!(
            local_deadline(&input(10 * MIB), 100, 750),
            Duration::from_millis(600)
        );
    }

    #[test]
    fn runtime_errors_keep_actionable_categories() {
        let error = wasmtime_error(wasmtime::Trap::OutOfFuel.into());
        assert_eq!(runtime_error_code(&error), "resource_limit");
        let error = wasmtime_error(wasmtime::Trap::Interrupt.into());
        assert_eq!(runtime_error_code(&error), "extension_timeout");
        let error = guest_error(bindings::clipsx::extension::types::GuestError {
            code: bindings::clipsx::extension::types::GuestErrorCode::InvalidInput,
            message: "clipboard credential".into(),
        });
        assert_eq!(runtime_error_code(&error), "invalid_input");
        assert!(!error.to_string().contains("credential"));
    }

    #[test]
    fn hostcall_transfer_limit_covers_expanding_transform_output() {
        let maximum_input = 10 * MIB;
        let maximum_base64_output = maximum_input.div_ceil(3) * 4;
        assert!(maximum_base64_output <= 14 * MIB);
        const { assert!(14 * MIB < HOSTCALL_TRANSFER_LIMIT) };
    }
}
