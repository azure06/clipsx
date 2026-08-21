use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::{redirect::Policy, Client};
use serde::Serialize;
use serde_json::json;
use sqlx::Row;

use crate::{
    contracts::{CompactPresentation, LeadingVisual, RenderModel},
    foundation::AppRoots,
    history::{new_id, now_ms, CapturedPayload, CapturedRepresentation, HistoryRepository},
};

use super::{
    ActionDisposition, ActionEffect, ActionHandler, ContributionKind, ContributionMatcher,
    ExecutionClass, ExtensionActionResult, ExtensionActionState, ExtensionContent,
    ExtensionLeadingVisual, ExtensionPackageStore, ExtensionRenderModel, ExtensionRepresentation,
    ExtensionRuntime, ExtensionSummary, InstallSource, ManifestContribution, RegistryIndex,
    RegistryPackage, RenderSurface, RuntimeStatus, UiSurface, ViewPurpose, OFFICIAL_REGISTRY_URL,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextActionDescriptor {
    pub id: String,
    pub package_id: String,
    pub label: String,
    pub icon: Option<String>,
    pub icon_svg: Option<String>,
    pub placements: Vec<String>,
    pub effects: Vec<String>,
    pub execution: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub parameter_schema: serde_json::Value,
    pub shortcut: Option<String>,
    pub pinned: bool,
    pub consent_required: bool,
    pub external_navigation_origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInvocation {
    pub token: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomViewSession {
    pub token: String,
    pub label: String,
    pub entry_url: String,
}

#[derive(Debug, Clone)]
pub enum ActionOutcome {
    Output {
        outputs: Vec<CapturedRepresentation>,
        disposition: ActionDisposition,
        action_id: String,
        version: String,
    },
    OpenHttpsUrl(String),
    Notification {
        level: String,
        message: String,
    },
    OpenDialog,
}

#[derive(Debug, Clone)]
pub struct ActiveContribution {
    pub extension_id: String,
    pub package_id: String,
    pub sha256: String,
    pub local_id: String,
    pub id: String,
    pub version: String,
    pub declaration: ManifestContribution,
    pub external_navigation_origins: Vec<String>,
    pub package_relative_path: std::path::PathBuf,
}

#[derive(Debug, Clone)]
struct PendingInvocation {
    package_sha256: String,
    action_id: String,
    clip_id: String,
    source_id: String,
    facet_id: Option<String>,
    expires_at: i64,
}

#[derive(Debug, Clone)]
struct PendingCustomView {
    package_relative_path: std::path::PathBuf,
    context_script: Vec<u8>,
    expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub id: String,
    pub label: String,
    pub configured: bool,
}

#[derive(Clone)]
pub struct ExtensionService {
    store: ExtensionPackageStore,
    runtime: ExtensionRuntime,
    invocations: Arc<Mutex<HashMap<String, PendingInvocation>>>,
    custom_views: Arc<Mutex<HashMap<String, PendingCustomView>>>,
}

impl ExtensionService {
    pub fn new(roots: &AppRoots) -> Result<Self> {
        Ok(Self {
            store: ExtensionPackageStore::new(roots.extensions())?,
            runtime: ExtensionRuntime::new()?,
            invocations: Arc::new(Mutex::new(HashMap::new())),
            custom_views: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn invalidate_runtime_sessions(&self) {
        self.invocations
            .lock()
            .expect("extension invocation store poisoned")
            .clear();
        self.custom_views
            .lock()
            .expect("extension custom view store poisoned")
            .clear();
    }

    pub async fn refresh_registry(&self) -> Result<RegistryIndex> {
        let response = Client::builder()
            .redirect(Policy::none())
            .build()?
            .get(OFFICIAL_REGISTRY_URL)
            .send()
            .await?
            .error_for_status()?;
        let bytes = response.bytes().await?;
        self.store.cache_registry(&bytes)
    }

    pub fn cached_registry(&self) -> Result<Option<RegistryIndex>> {
        self.store.cached_registry()
    }

    pub async fn registry(&self) -> Result<RegistryIndex> {
        match self.refresh_registry().await {
            Ok(index) => Ok(index),
            Err(_) => self
                .cached_registry()?
                .context("extension registry is unavailable and has no cached copy"),
        }
    }

    pub async fn install_registry(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
        version: &str,
    ) -> Result<ExtensionSummary> {
        let index = self.registry().await?;
        let entry = index
            .find(package_id, version)
            .context("reviewed extension package was not found")?
            .clone();
        let archive = download_release(&entry).await?;
        let package = self
            .store
            .install(&archive, InstallSource::Registry, Some(&entry))?;
        if let Some(component_path) = &package.component_path {
            self.runtime
                .validate_component(&package.sha256, component_path)
                .await?;
        }
        self.persist_install(repo, package, InstallSource::Registry)
            .await
    }

    pub async fn install_local(
        &self,
        repo: &HistoryRepository,
        path: &Path,
    ) -> Result<ExtensionSummary> {
        if !self.developer_mode(repo).await? {
            bail!("Developer Mode must be enabled before installing a local extension");
        }
        if path.extension().and_then(|value| value.to_str()) != Some("clipsx") {
            bail!("local extension package must use the .clipsx extension");
        }
        let archive = fs::read(path).context("unable to read local extension package")?;
        let package = self
            .store
            .install(&archive, InstallSource::Developer, None)?;
        if let Some(component_path) = &package.component_path {
            self.runtime
                .validate_component(&package.sha256, component_path)
                .await?;
        }
        self.persist_install(repo, package, InstallSource::Developer)
            .await
    }

    pub async fn inspect_local(
        &self,
        repo: &HistoryRepository,
        path: &Path,
    ) -> Result<ExtensionSummary> {
        if !self.developer_mode(repo).await? {
            bail!("Developer Mode must be enabled before inspecting a local extension");
        }
        if path.extension().and_then(|value| value.to_str()) != Some("clipsx") {
            bail!("local extension package must use the .clipsx extension");
        }
        let archive = fs::read(path).context("unable to read local extension package")?;
        let manifest = self.store.inspect(&archive)?;
        Ok(summary_from_manifest(
            manifest,
            InstallSource::Developer,
            false,
            RuntimeStatus::Ready,
        ))
    }

    pub async fn list(&self, repo: &HistoryRepository) -> Result<Vec<ExtensionSummary>> {
        let rows = sqlx::query("SELECT i.package_id,i.version,i.source,i.enabled,s.status,i.relative_path FROM extension_installs i JOIN extension_runtime_state s ON s.extension_id=i.id ORDER BY i.package_id")
            .fetch_all(&repo.pool).await?;
        rows.into_iter()
            .map(|row| {
                let source = match row.get::<String, _>(2).as_str() {
                    "registry" => InstallSource::Registry,
                    "developer" => InstallSource::Developer,
                    _ => bail!("stored extension source is invalid"),
                };
                let status = match row.get::<String, _>(4).as_str() {
                    "ready" => RuntimeStatus::Ready,
                    "quarantined" => RuntimeStatus::Quarantined,
                    "incompatible" => RuntimeStatus::Incompatible,
                    _ => bail!("stored extension status is invalid"),
                };
                let package = self.store.load(Path::new(&row.get::<String, _>(5)))?;
                Ok(ExtensionSummary {
                    package_id: row.get(0),
                    version: row.get(1),
                    display_name: package.manifest.display_name,
                    description: package.manifest.description,
                    source,
                    enabled: row.get::<i64, _>(3) != 0,
                    status,
                    http_origins: package
                        .manifest
                        .permissions
                        .http
                        .iter()
                        .map(|permission| permission.origin.clone())
                        .collect(),
                    credential_labels: package
                        .manifest
                        .permissions
                        .credentials
                        .iter()
                        .map(|permission| permission.label.clone())
                        .collect(),
                    unavailable_contributions: package
                        .manifest
                        .contributions
                        .iter()
                        .filter(|item| item.execution == ExecutionClass::CapabilityBacked)
                        .map(|item| item.display_name.clone())
                        .collect(),
                    checksum: Some(package.sha256),
                    external_navigation_origins: package
                        .manifest
                        .permissions
                        .external_navigation
                        .iter()
                        .map(|permission| permission.origin.clone())
                        .collect(),
                    providers: package.manifest.permissions.providers,
                    settings: package.manifest.settings,
                })
            })
            .collect()
    }

    pub async fn set_enabled(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
        enabled: bool,
    ) -> Result<()> {
        let result =
            sqlx::query("UPDATE extension_installs SET enabled=?,updated_at=? WHERE package_id=?")
                .bind(enabled)
                .bind(now_ms())
                .bind(package_id)
                .execute(&repo.pool)
                .await?;
        if result.rows_affected() == 0 {
            bail!("extension is not installed");
        }
        if !enabled {
            self.invalidate_runtime_sessions();
            sqlx::query("DELETE FROM extension_permission_grants WHERE extension_id=(SELECT id FROM extension_installs WHERE package_id=?)")
                .bind(package_id)
                .execute(&repo.pool)
                .await?;
            sqlx::query("DELETE FROM content_compact_presentations WHERE renderer_id LIKE ?")
                .bind(format!("{package_id}/%"))
                .execute(&repo.pool)
                .await?;
        }
        Ok(())
    }

    pub async fn recover(&self, repo: &HistoryRepository, package_id: &str) -> Result<()> {
        let mut transaction = repo.pool.begin().await?;
        let result = sqlx::query("UPDATE extension_runtime_state SET status='ready',updated_at=? WHERE extension_id=(SELECT id FROM extension_installs WHERE package_id=?) AND status='quarantined'")
            .bind(now_ms()).bind(package_id).execute(&mut *transaction).await?;
        if result.rows_affected() == 0 {
            bail!("extension is not quarantined");
        }
        sqlx::query("DELETE FROM extension_contribution_runtime_state WHERE extension_id=(SELECT id FROM extension_installs WHERE package_id=?)")
            .bind(package_id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn uninstall(&self, repo: &HistoryRepository, package_id: &str) -> Result<()> {
        self.invalidate_runtime_sessions();
        sqlx::query("DELETE FROM content_compact_presentations WHERE renderer_id LIKE ?")
            .bind(format!("{package_id}/%"))
            .execute(&repo.pool)
            .await?;
        let result = sqlx::query("DELETE FROM extension_installs WHERE package_id=?")
            .bind(package_id)
            .execute(&repo.pool)
            .await?;
        if result.rows_affected() == 0 {
            bail!("extension is not installed");
        }
        self.cleanup_unreferenced(repo).await
    }

    pub async fn developer_mode(&self, repo: &HistoryRepository) -> Result<bool> {
        let value: Option<String> = sqlx::query_scalar(
            "SELECT value_json FROM config_profile_values WHERE key='extensions.developer_mode'",
        )
        .fetch_optional(&repo.pool)
        .await?;
        Ok(value
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or(false))
    }

    pub async fn set_developer_mode(&self, repo: &HistoryRepository, enabled: bool) -> Result<()> {
        sqlx::query("INSERT INTO config_profile_values(key,value_json,updated_at) VALUES('extensions.developer_mode',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
            .bind(json!(enabled).to_string()).bind(now_ms()).execute(&repo.pool).await?;
        Ok(())
    }

    pub async fn active_contributions(
        &self,
        repo: &HistoryRepository,
        kind: ContributionKind,
    ) -> Result<Vec<ActiveContribution>> {
        let rows = sqlx::query("SELECT i.id,i.package_id,i.sha256,i.relative_path FROM extension_installs i JOIN extension_runtime_state s ON s.extension_id=i.id WHERE i.enabled=1 AND s.status='ready' ORDER BY i.package_id")
            .fetch_all(&repo.pool).await?;
        let mut values = Vec::new();
        for row in rows {
            let package = self.store.load(Path::new(&row.get::<String, _>(3)))?;
            if self.runtime.component(&package.sha256).is_none() && package.component_path.is_some()
            {
                self.runtime
                    .validate_component(
                        &package.sha256,
                        package
                            .component_path
                            .as_ref()
                            .expect("checked component path"),
                    )
                    .await?;
            }
            for declaration in
                package.manifest.contributions.iter().filter(|item| {
                    std::mem::discriminant(&item.kind) == std::mem::discriminant(&kind)
                })
            {
                values.push(ActiveContribution {
                    extension_id: row.get(0),
                    package_id: package.manifest.package_id.clone(),
                    sha256: package.sha256.clone(),
                    local_id: declaration.id.clone(),
                    id: package.manifest.qualified_contribution_id(&declaration.id),
                    version: declaration.version.clone(),
                    declaration: declaration.clone(),
                    external_navigation_origins: package
                        .manifest
                        .permissions
                        .external_navigation
                        .iter()
                        .map(|permission| permission.origin.clone())
                        .collect(),
                    package_relative_path: package.relative_path.clone(),
                });
            }
        }
        Ok(values)
    }

    pub async fn detect_clip(&self, repo: &HistoryRepository, clip_id: &str) -> Result<usize> {
        let detectors = self
            .active_contributions(repo, ContributionKind::Detector)
            .await?;
        if detectors.is_empty() {
            return Ok(0);
        }
        let detail = repo.detail(clip_id).await?;
        let mut count = 0;
        for representation_detail in detail.representations {
            let (input, _) = repo
                .source_representation(clip_id, &representation_detail.id)
                .await?;
            if !matches!(input.payload, CapturedPayload::Text(_))
                || payload_bytes(&input) > 1024 * 1024
            {
                continue;
            }
            for contribution in detectors
                .iter()
                .filter(|item| accepts(&item.declaration, &input, None))
            {
                let facets = self
                    .runtime
                    .detect(
                        &contribution.sha256,
                        &contribution.local_id,
                        representation(input.clone())?,
                    )
                    .await;
                match facets {
                    Ok(facets) => {
                        if facets.len() > 32 {
                            self.failure(
                                repo,
                                contribution,
                                &anyhow::anyhow!("extension detector emitted too many facets"),
                            )
                            .await?;
                            continue;
                        }
                        self.persist_facets(repo, &representation_detail.id, contribution, facets)
                            .await?;
                        self.success(repo, contribution).await?;
                        count += 1;
                    }
                    Err(error) => {
                        self.failure(repo, contribution, &error).await?;
                    }
                }
            }
        }
        Ok(count)
    }

    pub async fn redetect_history(&self, repo: &HistoryRepository) -> Result<u64> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM clip_items WHERE lifecycle_state='ready' ORDER BY captured_at",
        )
        .fetch_all(&repo.pool)
        .await?;
        let mut count = 0;
        for id in ids {
            count += self.detect_clip(repo, &id).await? as u64;
            self.refresh_compact_presentations(repo, &id).await?;
        }
        Ok(count)
    }

    pub async fn refresh_compact_history(&self, repo: &HistoryRepository) -> Result<u64> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM clip_items WHERE lifecycle_state='ready' ORDER BY captured_at",
        )
        .fetch_all(&repo.pool)
        .await?;
        let mut count = 0;
        for id in ids {
            count += self.refresh_compact_presentations(repo, &id).await? as u64;
        }
        Ok(count)
    }

    pub async fn refresh_compact_presentations(
        &self,
        repo: &HistoryRepository,
        clip_id: &str,
    ) -> Result<bool> {
        sqlx::query("DELETE FROM content_compact_presentations WHERE clip_id=?")
            .bind(clip_id)
            .execute(&repo.pool)
            .await?;
        let renderers = self
            .active_contributions(repo, ContributionKind::Renderer)
            .await?;
        let detail = repo.detail(clip_id).await?;
        let facets = crate::contributions::facets(repo, clip_id).await?;
        let preferences = crate::contributions::preferences(repo).await?;
        let faithful_first = detail.representations.iter().any(|rep| {
            matches!(
                rep.format_family.as_str(),
                "image" | "files" | "document" | "office"
            )
        });
        let mut candidates = Vec::new();
        for representation_detail in &detail.representations {
            let (source, _) = repo
                .source_representation(clip_id, &representation_detail.id)
                .await?;
            for renderer in &renderers {
                if renderer.declaration.execution != ExecutionClass::Local
                    || !renderer
                        .declaration
                        .surfaces
                        .contains(&RenderSurface::Compact)
                {
                    continue;
                }
                if accepts(&renderer.declaration, &source, None) {
                    candidates.push((
                        compact_rank(
                            renderer,
                            representation_detail,
                            None,
                            &preferences,
                            faithful_first,
                            &source,
                        ),
                        renderer.clone(),
                        source.clone(),
                        representation_detail.id.clone(),
                        None,
                    ));
                }
                for facet in facets
                    .iter()
                    .filter(|facet| facet.source_representation_id == representation_detail.id)
                {
                    if accepts(&renderer.declaration, &source, Some(&facet.id)) {
                        candidates.push((
                            compact_rank(
                                renderer,
                                representation_detail,
                                Some(facet),
                                &preferences,
                                faithful_first,
                                &source,
                            ),
                            renderer.clone(),
                            source.clone(),
                            representation_detail.id.clone(),
                            Some(facet.clone()),
                        ));
                    }
                }
            }
        }
        candidates.sort_by(|left, right| left.0.cmp(&right.0));
        let Some((_, contribution, input, source_id, facet)) = candidates.into_iter().next() else {
            return Ok(false);
        };
        let model = self
            .runtime
            .render_compact(
                &contribution.sha256,
                &contribution.local_id,
                representation(input.clone())?,
                facet.clone().map(|facet| super::ExtensionFacet {
                    id: facet.id,
                    payload_json: serde_json::to_string(&facet.payload).unwrap_or_default(),
                }),
            )
            .await;
        let model = match model {
            Ok(model) => validate_compact(model, &input)?,
            Err(error) => {
                self.failure(repo, &contribution, &error).await?;
                return Ok(false);
            }
        };
        let model_json = serde_json::to_string(&model)?;
        if model_json.len() > 2048 {
            bail!("extension compact presentation exceeds 2 KiB");
        }
        sqlx::query("INSERT INTO content_compact_presentations(clip_id,source_representation_id,renderer_id,renderer_version,facet_id,model_json,updated_at) VALUES(?,?,?,?,?,?,?)")
            .bind(clip_id)
            .bind(source_id)
            .bind(&contribution.id)
            .bind(&contribution.version)
            .bind(facet.map(|facet| facet.id).unwrap_or_default())
            .bind(model_json)
            .bind(now_ms())
            .execute(&repo.pool)
            .await?;
        self.success(repo, &contribution).await?;
        Ok(true)
    }

    pub async fn transformer_descriptors_for(
        &self,
        repo: &HistoryRepository,
        input: &CapturedRepresentation,
    ) -> Result<Vec<crate::contributions::transformer::TransformerDescriptor>> {
        Ok(self
            .active_contributions(repo, ContributionKind::Transformer)
            .await?
            .into_iter()
            .filter(|item| item.declaration.execution == ExecutionClass::Local)
            .filter(|item| accepts(&item.declaration, input, None))
            .map(
                |item| crate::contributions::transformer::TransformerDescriptor {
                    id: item.id,
                    version: item.version,
                    label: item.declaration.display_name,
                    parameter_schema: item.declaration.parameter_schema,
                    input_limit_bytes: 1024 * 1024,
                    timeout_ms: 500,
                },
            )
            .collect())
    }

    pub async fn renderer_descriptors(
        &self,
        repo: &HistoryRepository,
    ) -> Result<Vec<crate::contributions::RendererDescriptor>> {
        Ok(self
            .active_contributions(repo, ContributionKind::Renderer)
            .await?
            .into_iter()
            .map(|item| crate::contributions::RendererDescriptor {
                id: item.id,
                version: item.version,
                display_name: item.declaration.display_name,
                purpose: purpose_name(item.declaration.purpose).into(),
                surfaces: item
                    .declaration
                    .surfaces
                    .iter()
                    .map(|surface| surface_name(*surface).into())
                    .collect(),
                trusted_html: false,
            })
            .collect())
    }

    pub async fn context_actions(
        &self,
        repo: &HistoryRepository,
        clip_id: &str,
        source_id: &str,
        facet_id: Option<&str>,
    ) -> Result<Vec<ContextActionDescriptor>> {
        let (source, _) = repo.source_representation(clip_id, source_id).await?;
        let shortcuts = self.action_shortcuts(repo).await?;
        let pins = self.action_pins(repo).await?;
        let facet = self
            .action_facet(repo, clip_id, source_id, facet_id)
            .await?;
        let mut actions = Vec::new();
        for item in self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .filter(|item| accepts(&item.declaration, &source, facet_id))
        {
            let state = self
                .action_state(repo, &item, &source, facet.clone())
                .await?;
            if state == ExtensionActionState::Hidden {
                continue;
            }
            let (available, unavailable_reason) = match state {
                ExtensionActionState::Enabled => (true, None),
                ExtensionActionState::Disabled(reason) => (false, Some(reason)),
                ExtensionActionState::Hidden => unreachable!(),
            };
            let consent_required = self.consent_required(repo, &item).await?;
            let icon_svg = self.contribution_icon(&item);
            actions.push(ContextActionDescriptor {
                shortcut: shortcuts.get(&item.id).cloned(),
                pinned: pins.contains(&item.id),
                id: item.id,
                package_id: item.package_id,
                label: item.declaration.display_name,
                icon: item.declaration.icon,
                icon_svg,
                placements: item
                    .declaration
                    .placements
                    .iter()
                    .map(|placement| match placement {
                        super::ActionPlacement::PreviewToolbar => "preview_toolbar".into(),
                        super::ActionPlacement::ActionMenu => "action_menu".into(),
                    })
                    .collect(),
                effects: item
                    .declaration
                    .effects
                    .into_iter()
                    .map(action_effect_name)
                    .map(str::to_string)
                    .collect(),
                execution: execution_name(item.declaration.execution).into(),
                available,
                unavailable_reason,
                parameter_schema: item.declaration.parameter_schema,
                consent_required,
                external_navigation_origins: item.external_navigation_origins,
            });
        }
        actions.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
        Ok(actions)
    }

    pub async fn action_catalog(
        &self,
        repo: &HistoryRepository,
    ) -> Result<Vec<ContextActionDescriptor>> {
        let shortcuts = self.action_shortcuts(repo).await?;
        let pins = self.action_pins(repo).await?;
        let mut actions: Vec<_> = self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .map(|item| {
                let available = item.declaration.execution == ExecutionClass::Local;
                let icon_svg = self.contribution_icon(&item);
                ContextActionDescriptor {
                    shortcut: shortcuts.get(&item.id).cloned(),
                    pinned: pins.contains(&item.id),
                    id: item.id,
                    package_id: item.package_id,
                    label: item.declaration.display_name,
                    icon: item.declaration.icon,
                    icon_svg,
                    placements: item
                        .declaration
                        .placements
                        .iter()
                        .map(|placement| match placement {
                            super::ActionPlacement::PreviewToolbar => "preview_toolbar".into(),
                            super::ActionPlacement::ActionMenu => "action_menu".into(),
                        })
                        .collect(),
                    effects: item
                        .declaration
                        .effects
                        .into_iter()
                        .map(action_effect_name)
                        .map(str::to_string)
                        .collect(),
                    execution: execution_name(item.declaration.execution).into(),
                    available,
                    unavailable_reason: (!available)
                        .then(|| "Network capability broker is not available in this build".into()),
                    parameter_schema: item.declaration.parameter_schema,
                    consent_required: false,
                    external_navigation_origins: item.external_navigation_origins,
                }
            })
            .collect();
        actions.sort_by(|left, right| {
            left.package_id
                .cmp(&right.package_id)
                .then(left.label.cmp(&right.label))
        });
        Ok(actions)
    }

    pub async fn run_action(
        &self,
        repo: &HistoryRepository,
        action_id: &str,
        clip_id: &str,
        source_id: &str,
        facet_id: Option<&str>,
        parameters: serde_json::Value,
        invocation_token: Option<&str>,
    ) -> Result<ActionOutcome> {
        if !parameters.is_object() {
            bail!("extension action parameters must be an object");
        }
        let (source, _) = repo.source_representation(clip_id, source_id).await?;
        let contribution = self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .find(|item| item.id == action_id && accepts(&item.declaration, &source, facet_id))
            .context("contextual action is not available for this representation")?;
        if contribution.declaration.execution == ExecutionClass::CapabilityBacked {
            bail!("network capability broker is not available in this build");
        }
        if contribution
            .declaration
            .effects
            .contains(&ActionEffect::OpenHttpsUrl)
        {
            self.consume_invocation(
                &contribution,
                action_id,
                clip_id,
                source_id,
                facet_id,
                invocation_token.context("extension action requires an invocation token")?,
            )?;
        }
        let facet = self
            .action_facet(repo, clip_id, source_id, facet_id)
            .await?;
        match self
            .action_state(repo, &contribution, &source, facet.clone())
            .await?
        {
            ExtensionActionState::Enabled => {}
            ExtensionActionState::Hidden => bail!("extension action is hidden for this clip"),
            ExtensionActionState::Disabled(reason) => {
                bail!("extension action is disabled: {reason}")
            }
        }
        let outcome = match contribution
            .declaration
            .handler
            .clone()
            .context("action handler is missing")?
        {
            ActionHandler::Dialog => ActionOutcome::OpenDialog,
            ActionHandler::TransformerPreset {
                transformer_id,
                parameters: preset,
                disposition,
            } => {
                let parameters = merge_parameters(preset, parameters)?;
                let qualified = format!("{}/{}", contribution.package_id, transformer_id);
                let (_, outputs) = self
                    .transform(repo, &qualified, source.clone(), parameters)
                    .await?
                    .context("action transformer is unavailable")?;
                ActionOutcome::Output {
                    outputs,
                    disposition,
                    action_id: contribution.id.clone(),
                    version: contribution.version.clone(),
                }
            }
            ActionHandler::Guest => {
                let result = self
                    .runtime
                    .run_action(
                        &contribution.sha256,
                        &contribution.local_id,
                        representation(source)?,
                        facet.map(|facet| super::ExtensionFacet {
                            id: facet.id,
                            payload_json: serde_json::to_string(&facet.payload).unwrap_or_default(),
                        }),
                        serde_json::to_string(&parameters)?,
                    )
                    .await;
                match result {
                    Ok(result) => action_outcome(&contribution, result)?,
                    Err(error) => {
                        self.failure(repo, &contribution, &error).await?;
                        return Err(error);
                    }
                }
            }
        };
        validate_action_outcome(&contribution, &outcome)?;
        self.success(repo, &contribution).await?;
        Ok(outcome)
    }

    pub async fn grant_action_permissions(
        &self,
        repo: &HistoryRepository,
        action_id: &str,
    ) -> Result<()> {
        let contribution = self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .find(|item| item.id == action_id)
            .context("extension action is not installed and enabled")?;
        if contribution.external_navigation_origins.is_empty() {
            bail!("extension action has no grantable external navigation permission");
        }
        let mut transaction = repo.pool.begin().await?;
        for origin in &contribution.external_navigation_origins {
            sqlx::query("INSERT INTO extension_permission_grants(extension_id,package_sha256,permission_kind,permission_value,granted_at) VALUES(?,?, 'external_navigation', ?, ?) ON CONFLICT DO UPDATE SET granted_at=excluded.granted_at")
                .bind(&contribution.extension_id)
                .bind(&contribution.sha256)
                .bind(origin)
                .bind(now_ms())
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn issue_action_invocation(
        &self,
        repo: &HistoryRepository,
        action_id: &str,
        clip_id: &str,
        source_id: &str,
        facet_id: Option<&str>,
    ) -> Result<ActionInvocation> {
        let (source, _) = repo.source_representation(clip_id, source_id).await?;
        let contribution = self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .find(|item| item.id == action_id && accepts(&item.declaration, &source, facet_id))
            .context("contextual action is not available for this representation")?;
        if self.consent_required(repo, &contribution).await? {
            bail!("external data consent is required for this package release");
        }
        let facet = self
            .action_facet(repo, clip_id, source_id, facet_id)
            .await?;
        match self
            .action_state(repo, &contribution, &source, facet)
            .await?
        {
            ExtensionActionState::Enabled => {}
            ExtensionActionState::Hidden => bail!("extension action is hidden for this clip"),
            ExtensionActionState::Disabled(reason) => {
                bail!("extension action is disabled: {reason}")
            }
        }
        let token = uuid::Uuid::now_v7().to_string();
        let expires_at = now_ms() + 30_000;
        let mut invocations = self
            .invocations
            .lock()
            .expect("extension invocation store poisoned");
        invocations.retain(|_, invocation| invocation.expires_at > now_ms());
        invocations.insert(
            token.clone(),
            PendingInvocation {
                package_sha256: contribution.sha256,
                action_id: action_id.into(),
                clip_id: clip_id.into(),
                source_id: source_id.into(),
                facet_id: facet_id.map(str::to_string),
                expires_at,
            },
        );
        Ok(ActionInvocation { token, expires_at })
    }

    pub async fn begin_custom_view(
        &self,
        repo: &HistoryRepository,
        renderer_id: &str,
        clip_id: &str,
        source_id: &str,
        facet_id: Option<&str>,
        surface: UiSurface,
    ) -> Result<CustomViewSession> {
        let (source, _) = repo.source_representation(clip_id, source_id).await?;
        let contribution = self
            .active_contributions(repo, ContributionKind::Renderer)
            .await?
            .into_iter()
            .chain(
                self.active_contributions(repo, ContributionKind::Action)
                    .await?
                    .into_iter(),
            )
            .find(|item| {
                item.id == renderer_id
                    && accepts(&item.declaration, &source, facet_id)
                    && item.declaration.ui_surfaces.contains(&surface)
                    && (item.declaration.kind == ContributionKind::Renderer
                        || (surface == UiSurface::Dialog
                            && matches!(item.declaration.handler, Some(ActionHandler::Dialog))))
            })
            .context("custom extension detail view is unavailable")?;
        let entry = contribution
            .declaration
            .ui_entry
            .as_deref()
            .context("custom extension view has no entrypoint")?;
        let settings = self
            .package_settings(repo, &contribution.package_id)
            .await?;
        let credentials = self
            .credential_status(repo, &contribution.package_id)
            .await?;
        let token = uuid::Uuid::now_v7().to_string();
        let label = format!("extension-{}", uuid::Uuid::now_v7());
        let entry_url = format!("clipsx-extension://localhost/{token}/{entry}");
        let mut sessions = self
            .custom_views
            .lock()
            .expect("extension custom view store poisoned");
        sessions.retain(|_, session| session.expires_at > now_ms());
        sessions.insert(
            token.clone(),
            PendingCustomView {
                package_relative_path: contribution.package_relative_path,
                context_script: (format!(
                    "window.ClipsX=Object.freeze({{context:Object.freeze({})}});",
                    serde_json::to_string(&json!({
                        "representation": {
                            "formatKey": source.format_key,
                            "mimeType": source.canonical_mime_type,
                            "storageKind": match &source.payload {
                                CapturedPayload::Text(_) => "text",
                                CapturedPayload::Binary(_) => "binary_asset",
                                CapturedPayload::Files(_) => "file_list",
                            },
                            "text": match &source.payload {
                                CapturedPayload::Text(value) => Some(value.as_str()),
                                _ => None,
                            },
                        },
                        "facetId": facet_id,
                        "settings": settings,
                        "credentials": credentials,
                        "surface": match surface { UiSurface::Detail => "detail", UiSurface::Dialog => "dialog" },
                        "theme": "system",
                        "locale": "en",
                    }))?
                )
                + &format!(
                    "window.ClipsX.openDialog=()=>location.assign('clipsx-extension-bridge://{token}/open-dialog');window.ClipsX.close=()=>location.assign('clipsx-extension-bridge://{token}/close');"
                ))
                .into_bytes(),
                expires_at: now_ms() + 60 * 60 * 1000,
            },
        );
        Ok(CustomViewSession {
            token,
            label,
            entry_url,
        })
    }

    pub fn custom_view_asset(&self, token: &str, path: &str) -> Result<(Vec<u8>, &'static str)> {
        let sessions = self
            .custom_views
            .lock()
            .expect("extension custom view store poisoned");
        let session = sessions
            .get(token)
            .filter(|session| session.expires_at > now_ms())
            .context("extension custom view session is invalid or expired")?;
        if path == "__clipsx/context.js" {
            return Ok((
                session.context_script.clone(),
                "text/javascript; charset=utf-8",
            ));
        }
        let bytes = self
            .store
            .package_asset(&session.package_relative_path, path)?;
        let mime = match path.rsplit('.').next().unwrap_or_default() {
            "html" => "text/html; charset=utf-8",
            "js" | "mjs" => "text/javascript; charset=utf-8",
            "css" => "text/css; charset=utf-8",
            "json" => "application/json",
            "svg" => "image/svg+xml",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "woff2" => "font/woff2",
            _ => "application/octet-stream",
        };
        Ok((bytes, mime))
    }

    pub fn end_custom_view(&self, token: &str) {
        self.custom_views
            .lock()
            .expect("extension custom view store poisoned")
            .remove(token);
    }

    pub async fn package_settings(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
    ) -> Result<serde_json::Value> {
        let (extension_id, package) = self.package_for_settings(repo, package_id).await?;
        let rows = sqlx::query(
            "SELECT setting_id,value_json FROM extension_package_settings WHERE extension_id=?",
        )
        .bind(extension_id)
        .fetch_all(&repo.pool)
        .await?;
        let stored = rows
            .into_iter()
            .filter_map(|row| {
                let id: String = row.get(0);
                let value: String = row.get(1);
                serde_json::from_str(&value).ok().map(|value| (id, value))
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        Ok(serde_json::Value::Object(
            package
                .manifest
                .settings
                .into_iter()
                .map(|setting| {
                    let value = stored
                        .get(&setting.id)
                        .cloned()
                        .filter(|value| setting_value_is_valid(&setting, value))
                        .unwrap_or(setting.default);
                    (setting.id, value)
                })
                .collect(),
        ))
    }

    pub async fn set_package_setting(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
        setting_id: &str,
        value: serde_json::Value,
    ) -> Result<()> {
        let (extension_id, package) = self.package_for_settings(repo, package_id).await?;
        let setting = package
            .manifest
            .settings
            .iter()
            .find(|setting| setting.id == setting_id)
            .context("extension setting is not declared")?;
        if !setting_value_is_valid(setting, &value) {
            bail!("extension setting value does not match its declaration");
        }
        sqlx::query("INSERT INTO extension_package_settings(extension_id,setting_id,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(extension_id,setting_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
            .bind(extension_id).bind(setting_id).bind(serde_json::to_string(&value)?).bind(now_ms())
            .execute(&repo.pool).await?;
        Ok(())
    }

    pub async fn credential_status(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
    ) -> Result<Vec<CredentialStatus>> {
        let (_, package) = self.package_for_settings(repo, package_id).await?;
        package
            .manifest
            .permissions
            .credentials
            .into_iter()
            .map(|credential| {
                let entry = extension_credential_entry(package_id, &credential.id)?;
                let configured = matches!(entry.get_password(), Ok(value) if !value.is_empty());
                Ok(CredentialStatus {
                    id: credential.id,
                    label: credential.label,
                    configured,
                })
            })
            .collect()
    }

    pub async fn set_credential(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
        credential_id: &str,
        value: Option<&str>,
    ) -> Result<()> {
        let (_, package) = self.package_for_settings(repo, package_id).await?;
        if !package
            .manifest
            .permissions
            .credentials
            .iter()
            .any(|credential| credential.id == credential_id)
        {
            bail!("extension credential is not declared");
        }
        let entry = extension_credential_entry(package_id, credential_id)?;
        match value {
            Some(value) if !value.is_empty() && value.len() <= 8192 => entry.set_password(value)?,
            Some(_) => bail!("extension credential must be between 1 and 8192 bytes"),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => return Err(error.into()),
            },
        }
        Ok(())
    }

    async fn package_for_settings(
        &self,
        repo: &HistoryRepository,
        package_id: &str,
    ) -> Result<(String, super::ExtensionPackage)> {
        let row = sqlx::query("SELECT id,relative_path FROM extension_installs WHERE package_id=?")
            .bind(package_id)
            .fetch_optional(&repo.pool)
            .await?
            .context("extension package is not installed")?;
        Ok((
            row.get(0),
            self.store
                .load(std::path::Path::new(&row.get::<String, _>(1)))?,
        ))
    }

    pub async fn set_action_shortcut(
        &self,
        repo: &HistoryRepository,
        action_id: &str,
        accelerator: Option<&str>,
    ) -> Result<()> {
        let contribution = self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .find(|item| item.id == action_id)
            .context("extension action is not installed and enabled")?;
        if let Some(accelerator) = accelerator {
            if accelerator.is_empty() || accelerator.len() > 80 {
                bail!("action shortcut is invalid");
            }
            let conflict = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM extension_action_shortcuts WHERE lower(accelerator)=lower(?) AND action_id<>?",
            )
            .bind(accelerator)
            .bind(action_id)
            .fetch_one(&repo.pool)
            .await?;
            if conflict != 0 {
                bail!("action shortcut conflicts with an existing assignment");
            }
            sqlx::query("INSERT INTO extension_action_shortcuts(extension_id,action_id,accelerator,updated_at) VALUES(?,?,?,?) ON CONFLICT(action_id) DO UPDATE SET accelerator=excluded.accelerator,updated_at=excluded.updated_at")
                .bind(&contribution.extension_id)
                .bind(action_id)
                .bind(accelerator)
                .bind(now_ms())
                .execute(&repo.pool)
                .await
                .context("action shortcut conflicts with an existing assignment")?;
        } else {
            sqlx::query("DELETE FROM extension_action_shortcuts WHERE action_id=?")
                .bind(action_id)
                .execute(&repo.pool)
                .await?;
        }
        Ok(())
    }

    pub async fn set_action_pinned(
        &self,
        repo: &HistoryRepository,
        action_id: &str,
        pinned: bool,
    ) -> Result<()> {
        let contribution = self
            .active_contributions(repo, ContributionKind::Action)
            .await?
            .into_iter()
            .find(|item| item.id == action_id)
            .context("extension action is not installed and enabled")?;
        if pinned {
            sqlx::query("INSERT INTO extension_action_pins(extension_id,action_id,pinned_at) VALUES(?,?,?) ON CONFLICT(action_id) DO UPDATE SET extension_id=excluded.extension_id,pinned_at=excluded.pinned_at")
                .bind(&contribution.extension_id)
                .bind(action_id)
                .bind(now_ms())
                .execute(&repo.pool)
                .await?;
        } else {
            sqlx::query("DELETE FROM extension_action_pins WHERE action_id=?")
                .bind(action_id)
                .execute(&repo.pool)
                .await?;
        }
        Ok(())
    }

    async fn action_shortcuts(
        &self,
        repo: &HistoryRepository,
    ) -> Result<std::collections::BTreeMap<String, String>> {
        let rows = sqlx::query("SELECT action_id,accelerator FROM extension_action_shortcuts")
            .fetch_all(&repo.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.get(0), row.get(1)))
            .collect())
    }

    async fn action_pins(
        &self,
        repo: &HistoryRepository,
    ) -> Result<std::collections::BTreeSet<String>> {
        Ok(
            sqlx::query_scalar("SELECT action_id FROM extension_action_pins")
                .fetch_all(&repo.pool)
                .await?
                .into_iter()
                .collect(),
        )
    }

    fn contribution_icon(&self, contribution: &ActiveContribution) -> Option<String> {
        let path = contribution.declaration.icon_asset.as_deref()?;
        let bytes = self
            .store
            .package_asset(&contribution.package_relative_path, path)
            .ok()?;
        Some(format!(
            "data:image/svg+xml;base64,{}",
            BASE64.encode(bytes)
        ))
    }

    async fn consent_required(
        &self,
        repo: &HistoryRepository,
        contribution: &ActiveContribution,
    ) -> Result<bool> {
        if !contribution
            .declaration
            .effects
            .contains(&ActionEffect::OpenHttpsUrl)
        {
            return Ok(false);
        }
        if contribution.external_navigation_origins.is_empty() {
            return Ok(true);
        }
        let granted = sqlx::query_scalar::<_, String>(
            "SELECT permission_value FROM extension_permission_grants WHERE extension_id=? AND package_sha256=? AND permission_kind='external_navigation'",
        )
        .bind(&contribution.extension_id)
        .bind(&contribution.sha256)
        .fetch_all(&repo.pool)
        .await?;
        Ok(contribution
            .external_navigation_origins
            .iter()
            .any(|origin| !granted.contains(origin)))
    }

    fn consume_invocation(
        &self,
        contribution: &ActiveContribution,
        action_id: &str,
        clip_id: &str,
        source_id: &str,
        facet_id: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let invocation = self
            .invocations
            .lock()
            .expect("extension invocation store poisoned")
            .remove(token)
            .context("extension invocation token is invalid or already used")?;
        if invocation.expires_at <= now_ms()
            || invocation.package_sha256 != contribution.sha256
            || invocation.action_id != action_id
            || invocation.clip_id != clip_id
            || invocation.source_id != source_id
            || invocation.facet_id.as_deref() != facet_id
        {
            bail!("extension invocation token is expired or does not match this action scope");
        }
        Ok(())
    }

    async fn action_facet(
        &self,
        repo: &HistoryRepository,
        clip_id: &str,
        source_id: &str,
        facet_id: Option<&str>,
    ) -> Result<Option<crate::contributions::FacetDescriptor>> {
        Ok(if let Some(id) = facet_id {
            crate::contributions::facets(repo, clip_id)
                .await?
                .into_iter()
                .find(|facet| facet.id == id && facet.source_representation_id == source_id)
        } else {
            None
        })
    }

    async fn action_state(
        &self,
        repo: &HistoryRepository,
        contribution: &ActiveContribution,
        source: &CapturedRepresentation,
        facet: Option<crate::contributions::FacetDescriptor>,
    ) -> Result<ExtensionActionState> {
        if contribution.declaration.execution == ExecutionClass::CapabilityBacked {
            return Ok(ExtensionActionState::Disabled(
                "The extension network broker is not available in this build".into(),
            ));
        }
        if !matches!(contribution.declaration.handler, Some(ActionHandler::Guest)) {
            return Ok(ExtensionActionState::Enabled);
        }
        let state = self
            .runtime
            .action_state(
                &contribution.sha256,
                &contribution.local_id,
                representation(source.clone())?,
                facet.map(|facet| super::ExtensionFacet {
                    id: facet.id,
                    payload_json: serde_json::to_string(&facet.payload).unwrap_or_default(),
                }),
                "{}".into(),
            )
            .await;
        match state {
            Ok(state) => Ok(state),
            Err(error) => {
                self.failure(repo, contribution, &error).await?;
                Ok(ExtensionActionState::Disabled(
                    "Extension action state could not be evaluated".into(),
                ))
            }
        }
    }

    pub async fn renderer_views(
        &self,
        repo: &HistoryRepository,
        clip_id: &str,
        detail: &crate::history::ClipDetail,
        facets: &[crate::contributions::FacetDescriptor],
    ) -> Result<Vec<crate::contributions::ClipViewDescriptor>> {
        let renderers = self
            .active_contributions(repo, ContributionKind::Renderer)
            .await?;
        let mut views = Vec::new();
        for representation in &detail.representations {
            let (source, _) = repo
                .source_representation(clip_id, &representation.id)
                .await?;
            for renderer in &renderers {
                if renderer.declaration.execution == ExecutionClass::CapabilityBacked
                    || !renderer
                        .declaration
                        .surfaces
                        .contains(&RenderSurface::Detail)
                {
                    continue;
                }
                if accepts(&renderer.declaration, &source, None) {
                    views.push(crate::contributions::ClipViewDescriptor {
                        id: format!("{}:{}", renderer.id, representation.id),
                        renderer_id: renderer.id.clone(),
                        label: renderer.declaration.display_name.clone(),
                        source_id: representation.id.clone(),
                        mime_type: representation.canonical_mime_type.clone(),
                        capability_id: representation.capability_id.clone(),
                        facet_id: None,
                        is_original: false,
                        presentation_kind: if renderer
                            .declaration
                            .ui_surfaces
                            .contains(&UiSurface::Detail)
                        {
                            "extension_ui"
                        } else {
                            "extension"
                        }
                        .into(),
                        purpose: purpose_name(renderer.declaration.purpose).into(),
                        match_specificity: match_specificity(&renderer.declaration, &source, None),
                        placement: "alternate".into(),
                    });
                }
                for facet in facets
                    .iter()
                    .filter(|facet| facet.source_representation_id == representation.id)
                {
                    if accepts(&renderer.declaration, &source, Some(&facet.id)) {
                        views.push(crate::contributions::ClipViewDescriptor {
                            id: format!("{}:{}:{}", renderer.id, representation.id, facet.id),
                            renderer_id: renderer.id.clone(),
                            label: renderer.declaration.display_name.clone(),
                            source_id: representation.id.clone(),
                            mime_type: representation.canonical_mime_type.clone(),
                            capability_id: representation.capability_id.clone(),
                            facet_id: Some(facet.id.clone()),
                            is_original: false,
                            presentation_kind: if renderer
                                .declaration
                                .ui_surfaces
                                .contains(&UiSurface::Detail)
                            {
                                "extension_ui"
                            } else {
                                "extension"
                            }
                            .into(),
                            purpose: purpose_name(renderer.declaration.purpose).into(),
                            match_specificity: match_specificity(
                                &renderer.declaration,
                                &source,
                                Some(&facet.id),
                            ),
                            placement: "alternate".into(),
                        });
                    }
                }
            }
        }
        Ok(views)
    }

    pub async fn render(
        &self,
        repo: &HistoryRepository,
        renderer_id: &str,
        input: CapturedRepresentation,
        facet: Option<crate::contributions::FacetDescriptor>,
    ) -> Result<Option<RenderModel>> {
        let Some(contribution) = self
            .active_contributions(repo, ContributionKind::Renderer)
            .await?
            .into_iter()
            .find(|item| {
                item.id == renderer_id
                    && accepts(
                        &item.declaration,
                        &input,
                        facet.as_ref().map(|item| item.id.as_str()),
                    )
            })
        else {
            return Ok(None);
        };
        if contribution
            .declaration
            .ui_surfaces
            .contains(&UiSurface::Detail)
        {
            return Ok(Some(RenderModel::Text {
                text: String::new(),
            }));
        }
        let result = self
            .runtime
            .render_detail(
                &contribution.sha256,
                &contribution.local_id,
                representation(input)?,
                facet.map(|facet| super::ExtensionFacet {
                    id: facet.id,
                    payload_json: serde_json::to_string(&facet.payload).unwrap_or_default(),
                }),
            )
            .await;
        match result {
            Ok(model) => {
                self.success(repo, &contribution).await?;
                Ok(Some(render_model(model)?))
            }
            Err(error) => {
                self.failure(repo, &contribution, &error).await?;
                Err(error)
            }
        }
    }

    pub async fn transform(
        &self,
        repo: &HistoryRepository,
        transformer_id: &str,
        input: CapturedRepresentation,
        parameters: serde_json::Value,
    ) -> Result<Option<(String, Vec<CapturedRepresentation>)>> {
        let Some(contribution) = self
            .active_contributions(repo, ContributionKind::Transformer)
            .await?
            .into_iter()
            .find(|item| {
                item.id == transformer_id
                    && item.declaration.execution == ExecutionClass::Local
                    && accepts(&item.declaration, &input, None)
            })
        else {
            return Ok(None);
        };
        if !parameters.is_object() {
            bail!("extension transformer parameters must be an object");
        }
        let outputs = self
            .runtime
            .transform(
                &contribution.sha256,
                &contribution.local_id,
                representation(input)?,
                serde_json::to_string(&parameters)?,
            )
            .await;
        match outputs {
            Ok(outputs) => {
                let outputs = outputs
                    .into_iter()
                    .map(|output| {
                        if output.mime_type.is_empty() || !output.format_key.starts_with("mime:") {
                            bail!("extension transformer output must use a MIME format key")
                        }
                        let payload = match output.content {
                            ExtensionContent::Text(value) => CapturedPayload::Text(value),
                            ExtensionContent::Binary(value) => CapturedPayload::Binary(value),
                            ExtensionContent::Files(_) => {
                                bail!("extension transformers cannot emit file lists")
                            }
                        };
                        Ok(CapturedRepresentation {
                            format_key: output.format_key,
                            canonical_mime_type: Some(output.mime_type),
                            native_type: None,
                            platform: platform().into(),
                            capture_priority: 10,
                            payload,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                if outputs.is_empty()
                    || outputs.len() > 8
                    || outputs.iter().map(payload_bytes).sum::<usize>() > 10 * 1024 * 1024
                {
                    bail!("extension transformer output exceeds host limits");
                }
                self.success(repo, &contribution).await?;
                Ok(Some((contribution.version, outputs)))
            }
            Err(error) => {
                self.failure(repo, &contribution, &error).await?;
                Err(error)
            }
        }
    }

    async fn persist_install(
        &self,
        repo: &HistoryRepository,
        package: super::ExtensionPackage,
        source: InstallSource,
    ) -> Result<ExtensionSummary> {
        self.invalidate_runtime_sessions();
        let id: Option<String> =
            sqlx::query_scalar("SELECT id FROM extension_installs WHERE package_id=?")
                .bind(&package.manifest.package_id)
                .fetch_optional(&repo.pool)
                .await?;
        let id = id.unwrap_or_else(new_id);
        let source_name = match source {
            InstallSource::Registry => "registry",
            InstallSource::Developer => "developer",
        };
        let now = now_ms();
        let mut transaction = repo.pool.begin().await?;
        sqlx::query("INSERT INTO extension_installs(id,package_id,version,api_version,source,sha256,relative_path,enabled,installed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(package_id) DO UPDATE SET version=excluded.version,api_version=excluded.api_version,source=excluded.source,sha256=excluded.sha256,relative_path=excluded.relative_path,enabled=1,updated_at=excluded.updated_at")
            .bind(&id).bind(&package.manifest.package_id).bind(&package.manifest.version).bind(&package.manifest.api_version).bind(source_name).bind(&package.sha256).bind(package.relative_path.to_string_lossy().to_string()).bind(true).bind(now).bind(now).execute(&mut *transaction).await?;
        sqlx::query("INSERT INTO extension_runtime_state(extension_id,status,updated_at) VALUES(?, 'ready', ?) ON CONFLICT(extension_id) DO UPDATE SET status='ready',updated_at=excluded.updated_at")
            .bind(&id).bind(now).execute(&mut *transaction).await?;
        sqlx::query("DELETE FROM extension_contribution_runtime_state WHERE extension_id=?")
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
        // A package identity is stable but its bytes are not. Never carry a
        // data-egress approval across an update or developer replacement.
        sqlx::query("DELETE FROM extension_permission_grants WHERE extension_id=?")
            .bind(&id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(ExtensionSummary {
            package_id: package.manifest.package_id,
            version: package.manifest.version,
            display_name: package.manifest.display_name,
            description: package.manifest.description,
            source,
            enabled: true,
            status: RuntimeStatus::Ready,
            http_origins: package
                .manifest
                .permissions
                .http
                .iter()
                .map(|permission| permission.origin.clone())
                .collect(),
            credential_labels: package
                .manifest
                .permissions
                .credentials
                .iter()
                .map(|permission| permission.label.clone())
                .collect(),
            unavailable_contributions: package
                .manifest
                .contributions
                .iter()
                .filter(|item| item.execution == ExecutionClass::CapabilityBacked)
                .map(|item| item.display_name.clone())
                .collect(),
            checksum: Some(package.sha256),
            external_navigation_origins: package
                .manifest
                .permissions
                .external_navigation
                .iter()
                .map(|permission| permission.origin.clone())
                .collect(),
            providers: package.manifest.permissions.providers,
            settings: package.manifest.settings,
        })
    }

    async fn success(
        &self,
        repo: &HistoryRepository,
        contribution: &ActiveContribution,
    ) -> Result<()> {
        sqlx::query("INSERT INTO extension_contribution_runtime_state(extension_id,contribution_id,consecutive_failures,updated_at) VALUES(?,?,0,?) ON CONFLICT(extension_id,contribution_id) DO UPDATE SET consecutive_failures=0,last_error_code=NULL,last_error_message=NULL,last_failed_at=NULL,updated_at=excluded.updated_at")
            .bind(&contribution.extension_id).bind(&contribution.id).bind(now_ms()).execute(&repo.pool).await?;
        Ok(())
    }

    async fn persist_facets(
        &self,
        repo: &HistoryRepository,
        representation_id: &str,
        contribution: &ActiveContribution,
        facets: Vec<super::ExtensionFacet>,
    ) -> Result<()> {
        let mut transaction = repo.pool.begin().await?;
        sqlx::query(
            "DELETE FROM content_clip_facets WHERE source_representation_id=? AND detector_id=?",
        )
        .bind(representation_id)
        .bind(&contribution.id)
        .execute(&mut *transaction)
        .await?;
        for facet in facets {
            if !contribution
                .declaration
                .emits_facet_ids
                .iter()
                .any(|id| id == &facet.id)
            {
                bail!("extension detector emitted an undeclared facet");
            }
            let payload: serde_json::Value = serde_json::from_str(&facet.payload_json)
                .context("extension detector facet payload is not JSON")?;
            if !payload.is_object()
                || payload
                    .get("schemaVersion")
                    .and_then(serde_json::Value::as_u64)
                    != Some(1)
            {
                bail!("extension detector facet payload must be a schemaVersion 1 object");
            }
            let id = format!("{}.{}", contribution.package_id, facet.id);
            sqlx::query("INSERT INTO content_facet_definitions(id,owner_id,version,display_name) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,display_name=excluded.display_name")
                .bind(&id).bind(&contribution.package_id).bind(&contribution.version).bind(&facet.id).execute(&mut *transaction).await?;
            sqlx::query("INSERT INTO content_clip_facets(clip_id,facet_id,source_representation_id,detector_id,detector_version,payload_json,created_at) SELECT clip_id,?,?,?,?,?,? FROM clip_representations WHERE id=?")
                .bind(&id).bind(representation_id).bind(&contribution.id).bind(&contribution.version).bind(serde_json::to_string(&payload)?).bind(now_ms()).bind(representation_id).execute(&mut *transaction).await?;
        }
        sqlx::query("INSERT INTO content_detection_jobs(id,representation_id,detector_id,detector_version,status,attempt_count,requested_at,completed_at) VALUES(?,?,?,?, 'completed',1,?,?) ON CONFLICT(representation_id,detector_id) DO UPDATE SET detector_version=excluded.detector_version,status='completed',attempt_count=1,last_error=NULL,completed_at=excluded.completed_at")
            .bind(new_id()).bind(representation_id).bind(&contribution.id).bind(&contribution.version).bind(now_ms()).bind(now_ms()).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn failure(
        &self,
        repo: &HistoryRepository,
        contribution: &ActiveContribution,
        error: &anyhow::Error,
    ) -> Result<()> {
        let message = error.to_string().chars().take(512).collect::<String>();
        let now = now_ms();
        sqlx::query("INSERT INTO extension_contribution_runtime_state(extension_id,contribution_id,consecutive_failures,last_error_code,last_error_message,last_failed_at,updated_at) VALUES(?,?,1,'failed',?,?,?) ON CONFLICT(extension_id,contribution_id) DO UPDATE SET consecutive_failures=consecutive_failures+1,last_error_code='failed',last_error_message=excluded.last_error_message,last_failed_at=excluded.last_failed_at,updated_at=excluded.updated_at")
            .bind(&contribution.extension_id).bind(&contribution.id).bind(&message).bind(now).bind(now).execute(&repo.pool).await?;
        let failures: i64 = sqlx::query_scalar("SELECT consecutive_failures FROM extension_contribution_runtime_state WHERE extension_id=? AND contribution_id=?")
            .bind(&contribution.extension_id).bind(&contribution.id).fetch_one(&repo.pool).await?;
        if failures >= 3 {
            let mut transaction = repo.pool.begin().await?;
            sqlx::query("UPDATE extension_runtime_state SET status='quarantined',updated_at=? WHERE extension_id=?").bind(now).bind(&contribution.extension_id).execute(&mut *transaction).await?;
            sqlx::query("DELETE FROM content_clip_facets WHERE detector_id LIKE ?")
                .bind(format!("{}/%", contribution.package_id))
                .execute(&mut *transaction)
                .await?;
            sqlx::query("DELETE FROM content_detection_jobs WHERE detector_id LIKE ?")
                .bind(format!("{}/%", contribution.package_id))
                .execute(&mut *transaction)
                .await?;
            transaction.commit().await?;
        }
        Ok(())
    }

    async fn cleanup_unreferenced(&self, repo: &HistoryRepository) -> Result<()> {
        let roots: Vec<String> = sqlx::query_scalar("SELECT relative_path FROM extension_installs")
            .fetch_all(&repo.pool)
            .await?;
        let packages = self.store.packages_root();
        if !packages.exists() {
            return Ok(());
        }
        for package_id in fs::read_dir(&packages)? {
            let package_id = package_id?.path();
            if package_id.is_dir() {
                for version in fs::read_dir(&package_id)? {
                    let version = version?.path();
                    if version.is_dir() {
                        for hash in fs::read_dir(&version)? {
                            let hash = hash?.path();
                            let relative = hash
                                .strip_prefix(self.store.root())
                                .ok()
                                .map(|value| value.to_string_lossy().replace('\\', "/"));
                            if relative.as_ref().is_some_and(|value| {
                                !roots.iter().any(|root| root.replace('\\', "/") == *value)
                            }) {
                                fs::remove_dir_all(&hash)?;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

fn accepts(
    declaration: &ManifestContribution,
    input: &CapturedRepresentation,
    facet_id: Option<&str>,
) -> bool {
    declaration.matchers.is_empty()
        || declaration
            .matchers
            .iter()
            .any(|matcher| matcher_accepts(matcher, input, facet_id))
}

fn matcher_accepts(
    matcher: &ContributionMatcher,
    input: &CapturedRepresentation,
    facet_id: Option<&str>,
) -> bool {
    let native = input.native_type.as_deref().unwrap_or_default();
    let capability = crate::clipboard::capabilities::resolve(&input.platform, None, native);
    (matcher.mime_types.is_empty()
        || input
            .canonical_mime_type
            .as_ref()
            .is_some_and(|mime| matcher.mime_types.iter().any(|value| value == mime)))
        && (matcher.format_keys.is_empty()
            || matcher
                .format_keys
                .iter()
                .any(|value| value == &input.format_key))
        && (matcher.capability_ids.is_empty()
            || capability.is_some_and(|capability| {
                matcher
                    .capability_ids
                    .iter()
                    .any(|value| value == &capability.id)
            }))
        && (matcher.format_families.is_empty()
            || capability.is_some_and(|capability| {
                matcher
                    .format_families
                    .iter()
                    .any(|value| value == &capability.family)
            }))
        && (matcher.facet_ids.is_empty()
            || facet_id.is_some_and(|id| matcher.facet_ids.iter().any(|value| value == id)))
        && (matcher.storage_kinds.is_empty()
            || matcher.storage_kinds.iter().any(|value| {
                matches!(
                    (&input.payload, value.as_str()),
                    (CapturedPayload::Text(_), "text")
                        | (CapturedPayload::Binary(_), "binary_asset")
                        | (CapturedPayload::Files(_), "file_list")
                )
            }))
}

fn match_specificity(
    declaration: &ManifestContribution,
    input: &CapturedRepresentation,
    facet_id: Option<&str>,
) -> i32 {
    declaration
        .matchers
        .iter()
        .filter(|matcher| matcher_accepts(matcher, input, facet_id))
        .map(|matcher| {
            if !matcher.facet_ids.is_empty() {
                500
            } else if !matcher.capability_ids.is_empty() {
                400
            } else if !matcher.format_keys.is_empty() {
                300
            } else if !matcher.format_families.is_empty() {
                200
            } else if !matcher.mime_types.is_empty() {
                100
            } else {
                50
            }
        })
        .max()
        .unwrap_or(0)
}

fn purpose_name(value: Option<ViewPurpose>) -> &'static str {
    match value.unwrap_or(ViewPurpose::Diagnostic) {
        ViewPurpose::Faithful => "faithful",
        ViewPurpose::Structured => "structured",
        ViewPurpose::Semantic => "semantic",
        ViewPurpose::Source => "source",
        ViewPurpose::Diagnostic => "diagnostic",
    }
}

fn surface_name(value: RenderSurface) -> &'static str {
    match value {
        RenderSurface::Detail => "detail",
        RenderSurface::Compact => "compact",
    }
}

fn execution_name(value: ExecutionClass) -> &'static str {
    match value {
        ExecutionClass::Local => "local",
        ExecutionClass::CapabilityBacked => "capability_backed",
    }
}

fn action_effect_name(value: ActionEffect) -> &'static str {
    match value {
        ActionEffect::Preview => "preview",
        ActionEffect::Copy => "copy",
        ActionEffect::Paste => "paste",
        ActionEffect::SaveAsClip => "save_as_clip",
        ActionEffect::OpenHttpsUrl => "open_https_url",
        ActionEffect::Notification => "notification",
        ActionEffect::OpenDialog => "open_dialog",
    }
}

fn disposition_effect(value: ActionDisposition) -> ActionEffect {
    match value {
        ActionDisposition::Preview => ActionEffect::Preview,
        ActionDisposition::Copy => ActionEffect::Copy,
        ActionDisposition::Paste => ActionEffect::Paste,
        ActionDisposition::SaveAsClip => ActionEffect::SaveAsClip,
    }
}

fn merge_parameters(
    mut preset: serde_json::Value,
    supplied: serde_json::Value,
) -> Result<serde_json::Value> {
    let preset = preset
        .as_object_mut()
        .context("action preset parameters must be an object")?;
    let supplied = supplied
        .as_object()
        .context("action parameters must be an object")?;
    for (key, value) in supplied {
        preset.insert(key.clone(), value.clone());
    }
    Ok(serde_json::Value::Object(std::mem::take(preset)))
}

fn action_outcome(
    contribution: &ActiveContribution,
    value: ExtensionActionResult,
) -> Result<ActionOutcome> {
    Ok(match value {
        ExtensionActionResult::Output {
            outputs,
            disposition,
        } => ActionOutcome::Output {
            outputs: extension_outputs(outputs)?,
            disposition,
            action_id: contribution.id.clone(),
            version: contribution.version.clone(),
        },
        ExtensionActionResult::OpenHttpsUrl(url) => ActionOutcome::OpenHttpsUrl(url),
        ExtensionActionResult::Notification { level, message } => {
            ActionOutcome::Notification { level, message }
        }
    })
}

fn validate_action_outcome(
    contribution: &ActiveContribution,
    outcome: &ActionOutcome,
) -> Result<()> {
    let effect = match outcome {
        ActionOutcome::Output { disposition, .. } => disposition_effect(*disposition),
        ActionOutcome::OpenHttpsUrl(url) => {
            let parsed = url::Url::parse(url).context("action URL is invalid")?;
            if parsed.scheme() != "https" || parsed.host_str().is_none() || url.len() > 2048 {
                bail!("extension actions may open only bounded HTTPS URLs");
            }
            let requested_origin = parsed.origin().ascii_serialization();
            let permitted = contribution
                .external_navigation_origins
                .iter()
                .any(|origin| {
                    url::Url::parse(origin)
                        .map(|value| value.origin().ascii_serialization() == requested_origin)
                        .unwrap_or(false)
                });
            if !permitted {
                bail!("extension action requested an undeclared external navigation origin");
            }
            ActionEffect::OpenHttpsUrl
        }
        ActionOutcome::Notification { level, message } => {
            if !matches!(level.as_str(), "info" | "success" | "warning" | "error")
                || message.is_empty()
                || message.chars().count() > 512
            {
                bail!("extension notification is invalid");
            }
            ActionEffect::Notification
        }
        ActionOutcome::OpenDialog => ActionEffect::OpenDialog,
    };
    if !contribution.declaration.effects.contains(&effect) {
        bail!("extension action requested an undeclared effect");
    }
    Ok(())
}

fn extension_outputs(
    outputs: Vec<super::ExtensionOutputRepresentation>,
) -> Result<Vec<CapturedRepresentation>> {
    let outputs = outputs
        .into_iter()
        .map(|output| {
            if output.mime_type.is_empty() || !output.format_key.starts_with("mime:") {
                bail!("extension output must use a MIME format key")
            }
            let payload = match output.content {
                ExtensionContent::Text(value) => CapturedPayload::Text(value),
                ExtensionContent::Binary(value) => CapturedPayload::Binary(value),
                ExtensionContent::Files(_) => bail!("extensions cannot emit file lists"),
            };
            Ok(CapturedRepresentation {
                format_key: output.format_key,
                canonical_mime_type: Some(output.mime_type),
                native_type: None,
                platform: platform().into(),
                capture_priority: 10,
                payload,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if outputs.is_empty()
        || outputs.len() > 8
        || outputs.iter().map(payload_bytes).sum::<usize>() > 10 * 1024 * 1024
    {
        bail!("extension output exceeds host limits");
    }
    Ok(outputs)
}

fn compact_rank(
    contribution: &ActiveContribution,
    representation: &crate::history::RepresentationDetail,
    facet: Option<&crate::contributions::FacetDescriptor>,
    preferences: &crate::contributions::RendererPreferences,
    faithful_first: bool,
    input: &CapturedRepresentation,
) -> (bool, i32, i32, i64, i64, String) {
    let preferred = facet
        .and_then(|facet| preferences.by_facet_id.get(&facet.id))
        .or_else(|| {
            preferences
                .by_capability_id
                .get(&representation.capability_id)
        })
        .or_else(|| {
            representation
                .canonical_mime_type
                .as_ref()
                .and_then(|mime| preferences.by_mime_type.get(mime))
        })
        .is_some_and(|renderer| renderer == &contribution.id);
    let purpose = purpose_name(contribution.declaration.purpose);
    let purpose_rank = match (faithful_first, purpose) {
        (true, "faithful") | (false, "structured") => 0,
        (true, "structured") | (false, "semantic") => 1,
        (true, "semantic") | (false, "faithful") => 2,
        (_, "source") => 3,
        _ => 4,
    };
    (
        !preferred,
        purpose_rank,
        -match_specificity(
            &contribution.declaration,
            input,
            facet.map(|facet| facet.id.as_str()),
        ),
        representation.capture_priority,
        representation.ordinal,
        contribution.id.clone(),
    )
}

fn representation(value: CapturedRepresentation) -> Result<ExtensionRepresentation> {
    let content = match value.payload {
        CapturedPayload::Text(value) => ExtensionContent::Text(value),
        CapturedPayload::Binary(value) => ExtensionContent::Binary(value),
        CapturedPayload::Files(value) => ExtensionContent::Files(value),
    };
    let size = match &content {
        ExtensionContent::Text(value) => value.len(),
        ExtensionContent::Binary(value) => value.len(),
        ExtensionContent::Files(value) => value.iter().map(String::len).sum(),
    };
    if size > 1024 * 1024 {
        bail!("extension input exceeds 1 MiB");
    }
    Ok(ExtensionRepresentation {
        format_key: value.format_key,
        mime_type: value.canonical_mime_type,
        storage_kind: match content {
            ExtensionContent::Text(_) => "text",
            ExtensionContent::Binary(_) => "binary_asset",
            ExtensionContent::Files(_) => "file_list",
        }
        .into(),
        content,
    })
}

fn render_model(value: ExtensionRenderModel) -> Result<RenderModel> {
    Ok(match value {
        ExtensionRenderModel::Text(text) => RenderModel::Text { text },
        ExtensionRenderModel::Code { language, text } => RenderModel::Code { language, text },
        ExtensionRenderModel::Markdown(markdown) => RenderModel::Markdown { markdown },
        ExtensionRenderModel::Table { columns, rows } => RenderModel::Table { columns, rows },
        ExtensionRenderModel::Tree(value) => RenderModel::Tree {
            value: serde_json::from_str(&value).context("extension tree is not JSON")?,
        },
        ExtensionRenderModel::KeyValue(entries) => RenderModel::KeyValue { entries },
        ExtensionRenderModel::Card {
            leading,
            title,
            subtitle,
            fields,
        } => {
            validate_card(&title, subtitle.as_deref(), &fields)?;
            RenderModel::Card {
                leading: leading_visual(leading)?,
                title,
                subtitle,
                fields,
            }
        }
        ExtensionRenderModel::Image => RenderModel::Error {
            message: "community image renderers must reference a host-owned preview artifact"
                .into(),
        },
        ExtensionRenderModel::Error(message) => RenderModel::Error {
            message: message.chars().take(512).collect(),
        },
    })
}

fn leading_visual(value: ExtensionLeadingVisual) -> Result<LeadingVisual> {
    Ok(match value {
        ExtensionLeadingVisual::None => LeadingVisual::None,
        ExtensionLeadingVisual::HostIcon(name) => {
            super::manifest::valid_host_icon(&name)?;
            LeadingVisual::HostIcon { name }
        }
        ExtensionLeadingVisual::Swatch {
            red,
            green,
            blue,
            alpha,
        } => LeadingVisual::Swatch {
            red,
            green,
            blue,
            alpha,
        },
        ExtensionLeadingVisual::InputThumbnail => LeadingVisual::InputThumbnail,
        ExtensionLeadingVisual::Monogram(text) => {
            if text.chars().count() == 0 || text.chars().count() > 2 {
                bail!("extension monogram must contain one or two characters");
            }
            LeadingVisual::Monogram { text }
        }
    })
}

fn validate_card(title: &str, subtitle: Option<&str>, fields: &[(String, String)]) -> Result<()> {
    if title.is_empty()
        || title.chars().count() > 120
        || subtitle.is_some_and(|value| value.chars().count() > 200)
        || fields.len() > 32
        || fields.iter().any(|(label, value)| {
            label.is_empty() || label.chars().count() > 80 || value.chars().count() > 500
        })
    {
        bail!("extension card output exceeds host limits");
    }
    Ok(())
}

fn validate_compact(
    value: super::ExtensionCompactModel,
    input: &CapturedRepresentation,
) -> Result<CompactPresentation> {
    if value
        .title
        .as_ref()
        .is_some_and(|text| text.chars().count() > 120)
        || value
            .subtitle
            .as_ref()
            .is_some_and(|text| text.chars().count() > 200)
        || value
            .badge
            .as_ref()
            .is_some_and(|text| text.chars().count() > 32)
        || value.accessibility_label.is_empty()
        || value.accessibility_label.chars().count() > 160
    {
        bail!("extension compact presentation exceeds host field limits");
    }
    if matches!(value.leading, ExtensionLeadingVisual::InputThumbnail)
        && !(matches!(input.payload, CapturedPayload::Binary(_))
            && input
                .canonical_mime_type
                .as_deref()
                .is_some_and(|mime| mime.starts_with("image/")))
    {
        bail!("input thumbnail requires a managed image representation");
    }
    Ok(CompactPresentation {
        leading: leading_visual(value.leading)?,
        title: value.title,
        subtitle: value.subtitle,
        badge: value.badge,
        accessibility_label: value.accessibility_label,
    })
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux_x11"
    }
}

fn summary_from_manifest(
    manifest: super::ExtensionManifest,
    source: InstallSource,
    enabled: bool,
    status: RuntimeStatus,
) -> ExtensionSummary {
    ExtensionSummary {
        package_id: manifest.package_id,
        version: manifest.version,
        display_name: manifest.display_name,
        description: manifest.description,
        source,
        enabled,
        status,
        http_origins: manifest
            .permissions
            .http
            .iter()
            .map(|permission| permission.origin.clone())
            .collect(),
        credential_labels: manifest
            .permissions
            .credentials
            .iter()
            .map(|permission| permission.label.clone())
            .collect(),
        unavailable_contributions: manifest
            .contributions
            .iter()
            .filter(|item| item.execution == ExecutionClass::CapabilityBacked)
            .map(|item| item.display_name.clone())
            .collect(),
        checksum: None,
        external_navigation_origins: manifest
            .permissions
            .external_navigation
            .iter()
            .map(|permission| permission.origin.clone())
            .collect(),
        providers: manifest.permissions.providers,
        settings: manifest.settings,
    }
}
fn payload_bytes(value: &CapturedRepresentation) -> usize {
    match &value.payload {
        CapturedPayload::Text(value) => value.len(),
        CapturedPayload::Binary(value) => value.len(),
        CapturedPayload::Files(value) => value.iter().map(String::len).sum(),
    }
}

fn setting_value_is_valid(setting: &super::ExtensionSetting, value: &serde_json::Value) -> bool {
    match setting.kind.as_str() {
        "boolean" => value.is_boolean(),
        "string" => value.as_str().is_some_and(|value| value.len() <= 4096),
        "number" => value.is_number(),
        _ => false,
    }
}

fn extension_credential_entry(package_id: &str, credential_id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(
        "com.infiniti.clipsx.extension",
        &format!("{package_id}:{credential_id}"),
    )
    .map_err(Into::into)
}

async fn download_release(entry: &RegistryPackage) -> Result<Vec<u8>> {
    super::packages::validate_release_url(&entry.release_url)?;
    let client = Client::builder()
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many package redirects");
            }
            match attempt.url().host_str() {
                Some(
                    "github.com"
                    | "objects.githubusercontent.com"
                    | "github-releases.githubusercontent.com",
                ) if attempt.url().scheme() == "https" => attempt.follow(),
                _ => attempt.error("package redirect leaves GitHub HTTPS hosts"),
            }
        }))
        .build()?;
    let response = client
        .get(&entry.release_url)
        .send()
        .await?
        .error_for_status()?;
    let bytes = response.bytes().await?;
    if bytes.len() > 16 * 1024 * 1024 {
        bail!("extension package download exceeds 16 MiB");
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CapturedRepresentation {
        CapturedRepresentation {
            format_key: "windows:HTML Format".into(),
            canonical_mime_type: Some("text/html".into()),
            native_type: Some("HTML Format".into()),
            platform: "windows".into(),
            capture_priority: 20,
            payload: CapturedPayload::Text("{\"color\":\"#ff0040\"}".into()),
        }
    }

    fn renderer(matchers: Vec<ContributionMatcher>) -> ManifestContribution {
        ManifestContribution {
            id: "color-card".into(),
            kind: ContributionKind::Renderer,
            display_name: "Color card".into(),
            version: "1.0.0".into(),
            matchers,
            emits_facet_ids: vec![],
            purpose: Some(ViewPurpose::Semantic),
            surfaces: vec![RenderSurface::Detail, RenderSurface::Compact],
            execution: ExecutionClass::Local,
            icon: Some("palette".into()),
            icon_asset: None,
            placements: vec![],
            ui_surfaces: vec![],
            ui_entry: None,
            effects: vec![],
            handler: None,
            parameter_schema: json!({}),
        }
    }

    #[test]
    fn matcher_clauses_are_or_and_clause_fields_are_and() {
        let declaration = renderer(vec![
            ContributionMatcher {
                mime_types: vec!["text/html".into()],
                facet_ids: vec!["color".into()],
                ..Default::default()
            },
            ContributionMatcher {
                format_keys: vec!["mime:application/json".into()],
                ..Default::default()
            },
        ]);
        assert!(accepts(&declaration, &input(), Some("color")));
        assert!(!accepts(&declaration, &input(), Some("url")));
    }

    #[test]
    fn compact_models_are_bounded_and_thumbnail_is_host_owned() {
        let valid = validate_compact(
            super::super::ExtensionCompactModel {
                leading: ExtensionLeadingVisual::Swatch {
                    red: 255,
                    green: 0,
                    blue: 64,
                    alpha: 255,
                },
                title: Some("#FF0040".into()),
                subtitle: None,
                badge: Some("HEX".into()),
                accessibility_label: "Bright red color".into(),
            },
            &input(),
        );
        assert!(valid.is_ok());

        let invalid_thumbnail = validate_compact(
            super::super::ExtensionCompactModel {
                leading: ExtensionLeadingVisual::InputThumbnail,
                title: None,
                subtitle: None,
                badge: None,
                accessibility_label: "Preview".into(),
            },
            &input(),
        );
        assert!(invalid_thumbnail.is_err());
    }
}
