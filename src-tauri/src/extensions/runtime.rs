use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{anyhow, bail, Context, Result};
use bindings::Extension;
use serde::{Deserialize, Serialize};
use tokio::time::timeout;
use wasmtime::{
    component::{Component, Linker},
    Config, Engine, Store, StoreLimits, StoreLimitsBuilder,
};

mod bindings {
    wasmtime::component::bindgen!({
        path: "wit",
        world: "extension",
        exports: { default: async },
    });
}

const MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const TABLE_ELEMENTS_LIMIT: usize = 10_000;
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
    Card {
        leading: ExtensionLeadingVisual,
        title: String,
        subtitle: Option<String>,
        fields: Vec<(String, String)>,
    },
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

struct StoreData {
    limits: StoreLimits,
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
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(100))
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
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(250))
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
            .binding_instance(sha256, DETECT_RENDER_FUEL, Duration::from_millis(100))
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
    ) -> Result<Vec<ExtensionOutputRepresentation>> {
        let (mut store, instance) = self
            .binding_instance(sha256, TRANSFORM_FUEL, Duration::from_millis(500))
            .await?;
        let result = timeout(
            Duration::from_millis(500),
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
    ) -> Result<ExtensionActionResult> {
        let (mut store, instance) = self
            .binding_instance(sha256, TRANSFORM_FUEL, Duration::from_millis(500))
            .await?;
        let result = timeout(
            Duration::from_millis(500),
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

    async fn binding_instance(
        &self,
        sha256: &str,
        fuel: u64,
        deadline: Duration,
    ) -> Result<(Store<StoreData>, Extension)> {
        let component = self
            .component(sha256)
            .context("extension component is not loaded")?;
        let mut store = new_store(&self.engine, fuel)?;
        let linker = Linker::<StoreData>::new(&self.engine);
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
        let mut store = new_store(&self.engine, fuel)?;
        let linker = Linker::<StoreData>::new(&self.engine);
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

fn new_store(engine: &Engine, fuel: u64) -> Result<Store<StoreData>> {
    let mut store = Store::new(
        engine,
        StoreData {
            limits: StoreLimitsBuilder::new()
                .memory_size(MEMORY_LIMIT)
                .table_elements(TABLE_ELEMENTS_LIMIT)
                .memories(1)
                .tables(1)
                .instances(1)
                .trap_on_grow_failure(true)
                .build(),
        },
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(fuel).map_err(wasmtime_error)?;
    store.set_hostcall_fuel(1024 * 1024);
    store.set_epoch_deadline(1);
    store.epoch_deadline_trap();
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
        RenderModel::Card(value) => ExtensionRenderModel::Card {
            leading: from_wit_leading(value.leading),
            title: value.title,
            subtitle: value.subtitle,
            fields: value
                .fields
                .into_iter()
                .map(|field| (field.label, field.value))
                .collect(),
        },
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

fn wasmtime_error(error: wasmtime::Error) -> anyhow::Error {
    anyhow!(error.to_string())
}
