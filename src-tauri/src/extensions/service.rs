use std::{fs, path::Path};

use anyhow::{bail, Context, Result};
use reqwest::{redirect::Policy, Client};
use serde_json::json;
use sqlx::Row;

use crate::{
    contracts::RenderModel,
    foundation::AppRoots,
    history::{new_id, now_ms, CapturedPayload, CapturedRepresentation, HistoryRepository},
};

use super::{
    ContributionKind, ExtensionContent, ExtensionPackageStore, ExtensionRenderModel,
    ExtensionRepresentation, ExtensionRuntime, ExtensionSummary, InstallSource,
    ManifestContribution, RegistryIndex, RegistryPackage, RuntimeStatus, OFFICIAL_REGISTRY_URL,
};

#[derive(Debug, Clone)]
pub struct ActiveContribution {
    pub extension_id: String,
    pub package_id: String,
    pub sha256: String,
    pub local_id: String,
    pub id: String,
    pub version: String,
    pub declaration: ManifestContribution,
}

#[derive(Clone)]
pub struct ExtensionService {
    store: ExtensionPackageStore,
    runtime: ExtensionRuntime,
}

impl ExtensionService {
    pub fn new(roots: &AppRoots) -> Result<Self> {
        Ok(Self {
            store: ExtensionPackageStore::new(roots.extensions())?,
            runtime: ExtensionRuntime::new()?,
        })
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
        self.runtime
            .validate_component(&package.sha256, &package.component_path)
            .await?;
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
        self.runtime
            .validate_component(&package.sha256, &package.component_path)
            .await?;
        self.persist_install(repo, package, InstallSource::Developer)
            .await
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
            if self.runtime.component(&package.sha256).is_none() {
                self.runtime
                    .validate_component(&package.sha256, &package.component_path)
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
        }
        Ok(count)
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
                priority: item.declaration.priority,
                trusted_html: false,
            })
            .collect())
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
                if renderer.declaration.facet_ids.is_empty()
                    && accepts(&renderer.declaration, &source, None)
                {
                    views.push(crate::contributions::ClipViewDescriptor {
                        id: format!("{}:{}", renderer.id, representation.id),
                        renderer_id: renderer.id.clone(),
                        label: renderer.declaration.display_name.clone(),
                        source_id: representation.id.clone(),
                        mime_type: representation.canonical_mime_type.clone(),
                        facet_id: None,
                        is_original: false,
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
                            facet_id: Some(facet.id.clone()),
                            is_original: false,
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
        let result = self
            .runtime
            .render(
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
            .find(|item| item.id == transformer_id && accepts(&item.declaration, &input, None))
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
        transaction.commit().await?;
        Ok(ExtensionSummary {
            package_id: package.manifest.package_id,
            version: package.manifest.version,
            display_name: package.manifest.display_name,
            description: package.manifest.description,
            source,
            enabled: true,
            status: RuntimeStatus::Ready,
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
                .facet_ids
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
    (declaration.mime_types.is_empty()
        || input
            .canonical_mime_type
            .as_ref()
            .is_some_and(|mime| declaration.mime_types.iter().any(|value| value == mime)))
        && (declaration.format_keys.is_empty()
            || declaration
                .format_keys
                .iter()
                .any(|value| value == &input.format_key))
        && (declaration.facet_ids.is_empty()
            || facet_id.is_some_and(|id| declaration.facet_ids.iter().any(|value| value == id)))
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
        ExtensionRenderModel::Image => RenderModel::Error {
            message: "community image renderers must reference a host-owned preview artifact"
                .into(),
        },
        ExtensionRenderModel::Error(message) => RenderModel::Error {
            message: message.chars().take(512).collect(),
        },
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
fn payload_bytes(value: &CapturedRepresentation) -> usize {
    match &value.payload {
        CapturedPayload::Text(value) => value.len(),
        CapturedPayload::Binary(value) => value.len(),
        CapturedPayload::Files(value) => value.iter().map(String::len).sum(),
    }
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
