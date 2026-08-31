use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{anyhow, bail, Context, Result};
use bindings::Extension;
use serde::{Deserialize, Serialize};
use tokio::time::timeout;
use wasmtime::{
    component::{Component, HasSelf, Linker},
    Config, Engine, Store, StoreLimits, StoreLimitsBuilder,
};

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

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeErrorCode {
    Load,
    Trap,
    Fuel,
    Timeout,
    Memory,
    InvalidOutput,
    Cancelled,
}

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
    pub format_key: String,
    pub mime_type: String,
    pub content: ExtensionContent,
}

#[derive(Debug, Clone)]
pub enum ExtensionActionResult {
    Output {
        outputs: Vec<ExtensionOutputRepresentation>,
        disposition: super::ActionDisposition,
    },
    OpenHttpsUrl(String),
    Notification {
        level: String,
        message: String,
    },
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
    pub injected_headers: BTreeMap<String, BTreeMap<String, String>>,
    pub protected_secrets: Vec<Vec<u8>>,
    pub generation_allowed: bool,
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

    async fn generate_text(&mut self, prompt: String) -> std::result::Result<String, String> {
        let context = self
            .broker
            .clone()
            .filter(|context| context.generation_allowed)
            .ok_or_else(|| "generation.text is unavailable for this invocation".to_string())?;
        crate::providers::generation::generate(&context.repo, &prompt)
            .await
            .map_err(|error| bounded_error(&error))
    }
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
}

impl ExtensionRuntime {
    pub fn new() -> Result<Self> {
        let mut config = Config::new();
        config.wasm_component_model(true);
        config.consume_fuel(true);
        config.epoch_interruption(true);
        config.max_wasm_stack(2 * 1024 * 1024);
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
        })
    }

    pub async fn validate_component(&self, sha256: &str, path: &Path) -> Result<()> {
        let bytes = tokio::fs::read(path)
            .await
            .context("unable to read extension component")?;
        if bytes.len() > 8 * 1024 * 1024 {
            bail!("extension component exceeds 8 MiB");
        }
        let component = Component::new(&self.engine, bytes)
            .map_err(wasmtime_error)
            .context("extension component is invalid")?;
        self.instantiate(
            component.clone(),
            DETECT_RENDER_FUEL,
            Duration::from_millis(250),
        )
        .await?;
        self.components
            .lock()
            .expect("extension component cache poisoned")
            .insert(sha256.into(), component);
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
        let (mut store, instance) = self
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(100), None)
            .await?;
        let result = timeout(
            Duration::from_millis(100),
            instance.call_detect(&mut store, contribution_id, &to_wit_representation(input)),
        )
        .await
        .map_err(|_| anyhow!("extension detector timed out"))?
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
        let (mut store, instance) = self
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(250), None)
            .await?;
        let result = timeout(
            Duration::from_millis(250),
            instance.call_render_detail(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
            ),
        )
        .await
        .map_err(|_| anyhow!("extension renderer timed out"))?
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
        let (mut store, instance) = self
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(100), None)
            .await?;
        let result = timeout(
            Duration::from_millis(100),
            instance.call_render_compact(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
            ),
        )
        .await
        .map_err(|_| anyhow!("extension compact renderer timed out"))?
        .map_err(wasmtime_error)?;
        result.map(from_wit_compact_model).map_err(guest_error)
    }

    pub async fn transform(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        parameters_json: String,
        broker: Option<RuntimeBrokerContext>,
    ) -> Result<Vec<ExtensionOutputRepresentation>> {
        let deadline = if broker.is_some() {
            Duration::from_secs(125)
        } else {
            Duration::from_millis(500)
        };
        let (mut store, instance) = self
            .binding_instance(sha256, TRANSFORM_FUEL, deadline, broker)
            .await?;
        let result = timeout(
            deadline,
            instance.call_transform(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                &parameters_json,
            ),
        )
        .await
        .map_err(|_| anyhow!("extension transformer timed out"))?
        .map_err(wasmtime_error)?;
        result
            .map(|outputs| outputs.into_iter().map(from_wit_output).collect())
            .map_err(guest_error)
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
        let deadline = if broker.is_some() {
            Duration::from_secs(125)
        } else {
            Duration::from_millis(500)
        };
        let (mut store, instance) = self
            .binding_instance(sha256, TRANSFORM_FUEL, deadline, broker)
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
        .map_err(|_| anyhow!("extension action timed out"))?
        .map_err(wasmtime_error)?;
        result.map(from_wit_action_result).map_err(guest_error)
    }

    pub async fn action_state(
        &self,
        sha256: &str,
        contribution_id: &str,
        input: ExtensionRepresentation,
        facet: Option<ExtensionFacet>,
        settings_json: String,
    ) -> Result<ExtensionActionState> {
        let (mut store, instance) = self
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(100), None)
            .await?;
        let result = timeout(
            Duration::from_millis(100),
            instance.call_action_state(
                &mut store,
                contribution_id,
                &to_wit_representation(input),
                facet.map(to_wit_facet).as_ref(),
                &settings_json,
            ),
        )
        .await
        .map_err(|_| anyhow!("extension action-state timed out"))?
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
        .map_err(|_| anyhow!("extension component instantiation timed out"))?
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
        .map_err(|_| anyhow!("extension component instantiation timed out"))?
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
    store.set_hostcall_fuel(1024 * 1024);
    store.set_epoch_deadline(1);
    // Yield every epoch so Tokio can enforce the invocation's outer timeout.
    // Trapping here would expire while an async broker call is legitimately
    // waiting and then kill the guest as soon as that host call returns.
    store.epoch_deadline_async_yield_and_update(1);
    Ok(store)
}

fn guest_error(error: bindings::clipsx::extension::types::GuestError) -> anyhow::Error {
    let message = error.message.chars().take(512).collect::<String>();
    anyhow!("extension returned {:?}: {message}", error.code)
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
    use bindings::clipsx::extension::types::{ActionDisposition, ActionResult};
    match value {
        ActionResult::Output((outputs, disposition)) => ExtensionActionResult::Output {
            outputs: outputs.into_iter().map(from_wit_output).collect(),
            disposition: match disposition {
                ActionDisposition::Preview => super::ActionDisposition::Preview,
                ActionDisposition::Copy => super::ActionDisposition::Copy,
                ActionDisposition::Paste => super::ActionDisposition::Paste,
                ActionDisposition::SaveAsClip => super::ActionDisposition::SaveAsClip,
            },
        },
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
    anyhow!(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::contains_protected_secret;

    #[test]
    fn credential_reflection_check_is_exact_and_ignores_empty_values() {
        let secrets = vec![Vec::new(), b"token-value".to_vec()];
        assert!(contains_protected_secret(
            b"{\"authorization\":\"token-value\"}",
            &secrets
        ));
        assert!(!contains_protected_secret(b"safe response", &secrets));
    }
}
