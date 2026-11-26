use serde::{Deserialize, Serialize};
use crate::document_library::{self, DocumentPublication, LibraryDocument, LibraryDocumentMetadata};
use std::{
  collections::BTreeMap,
  fs,
  path::{Path, PathBuf},
  sync::RwLock,
};

const SETTINGS_FILE: &str = "platform-settings.json";
const REGISTRY_FILE: &str = "capability-registry.json";
const INSTALLED_CAPABILITIES_DIR: &str = "installed-capabilities";
/// The agent a Capability invokes through when a person has not chosen one. Codex, because it is
/// the agent Nooki already integrates most deeply.
pub const DEFAULT_AGENT: &str = "codex";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityManifest {
  pub id: String,
  pub version: String,
  pub name: String,
  #[serde(default)]
  pub description: String,
  #[serde(default)]
  pub locales: BTreeMap<String, CapabilityManifestTranslation>,
  #[serde(default)]
  pub entrypoints: Vec<CapabilityEntrypoint>,
  #[serde(default)]
  pub permissions: Vec<CapabilityPermission>,
  pub min_platform_version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityManifestTranslation {
  pub name: String,
  #[serde(default)]
  pub description: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityEntrypoint {
  Page,
  Command,
  Widget,
  Job,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CapabilityPermission {
  #[serde(rename = "storage")]
  Storage,
  #[serde(rename = "activity.read")]
  ActivityRead,
  #[serde(rename = "activity.write")]
  ActivityWrite,
  #[serde(rename = "ai.invoke")]
  AiInvoke,
  #[serde(rename = "codex.sessions.read")]
  CodexSessionsRead,
  #[serde(rename = "documents.publish")]
  DocumentsPublish,
  #[serde(rename = "documents.read-selected")]
  DocumentsReadSelected,
  #[serde(rename = "board.create")]
  BoardCreate,
  #[serde(rename = "board.attach-delivery")]
  BoardAttachDelivery,
  #[serde(rename = "conversations.handoff")]
  ConversationsHandoff,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCapability {
  pub manifest: CapabilityManifest,
  pub enabled: bool,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub package_version: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub previous_package_version: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct CapabilityRegistry {
  capabilities: Vec<InstalledCapability>,
  #[serde(default)]
  generations: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformSettings {
  /// Was `selectedProvider`, when Nooki called model services itself. The alias keeps a settings
  /// file written before that changed readable.
  #[serde(alias = "selectedProvider")]
  capability_agent: String,
}

impl Default for PlatformSettings {
  fn default() -> Self {
    Self {
      capability_agent: DEFAULT_AGENT.into(),
    }
  }
}

pub struct PlatformState {
  data_dir: PathBuf,
  settings: RwLock<PlatformSettings>,
  registry: RwLock<CapabilityRegistry>,
  pub(crate) document_selections: std::sync::Mutex<BTreeMap<String, crate::document_selection::Selection>>,
  pub(crate) handoff_selections: std::sync::Mutex<BTreeMap<String, crate::conversation_handoff_selection::Selection>>,
  pub(crate) task_selections: std::sync::Mutex<BTreeMap<String, crate::task_selection::Selection>>,
}

impl PlatformState {
  pub fn load(data_dir: PathBuf) -> Result<Self, String> {
    let settings = load_json(&data_dir.join(SETTINGS_FILE))?;
    // Startup serializes with an already admitted worker effect, then invalidates all old handles.
    #[cfg(unix)]
    let _fence = crate::capability_authority::fence(&data_dir)?;
    let registry = load_registry(&data_dir)?;
    #[cfg(unix)]
    crate::capability_authority::Authority::default().save(&data_dir)?;
    Ok(Self {
      data_dir,
      settings: RwLock::new(settings),
      registry: RwLock::new(registry),
      document_selections: std::sync::Mutex::new(BTreeMap::new()),
      task_selections: std::sync::Mutex::new(BTreeMap::new()),
      handoff_selections: std::sync::Mutex::new(BTreeMap::new()),
    })
  }

  pub fn data_dir(&self) -> &Path { &self.data_dir }

  /// Trusted native controller only: calling this method is the board-create grant decision.
  /// Manifest permission is necessary, not user approval. Do not expose this method to packages.
  pub fn grant_board_creation(&self, caller: &str, id: &str, expected_version: &str) -> Result<String, String> {
    self.grant_board_operation(caller, id, expected_version, "board.create")
  }
  /// Native controller only. A separate explicit task grant is still required for each effect.
  pub fn grant_board_attachment(&self, caller: &str, id: &str, expected_version: &str) -> Result<String, String> {
    self.grant_board_operation(caller, id, expected_version, "board.attachDelivery")
  }
  fn grant_board_operation(&self, caller: &str, id: &str, expected_version: &str, operation: &str) -> Result<String, String> {
    let permission = board_permission(operation).ok_or("PERMISSION_DENIED: unsupported board operation")?;
    let mut registry = self.registry.write().map_err(|_| "RESOURCE_UNAVAILABLE: registry unavailable")?;
    let installed = registry.capabilities.iter().find(|item| item.manifest.id == id && item.enabled && item.manifest.version == expected_version)
      .ok_or("PERMISSION_DENIED: installation is not active at the expected version")?;
    if !installed.manifest.permissions.contains(&permission) {
      return Err(format!("PERMISSION_DENIED: capability requires {}", permission.as_str()));
    }
    let version = installed.manifest.version.clone();
    if !registry.generations.contains_key(id) {
      let next = registry.clone();
      self.commit_registry(&mut registry, next, id)?;
    }
    let context = crate::capability_authority::InvocationContext { capability_id:id.into(), capability_version:version, generation:registry.generations[id].clone() };
    let _fence = crate::capability_authority::fence(&self.data_dir)?;
    let current = load_registry(&self.data_dir)?;
    if current != *registry { return Err("CONFLICT: installation changed; reload the host state".into()); }
    let mut authority = crate::capability_authority::Authority::load(&self.data_dir)?;
    authority.retain_current(|context, operation| current.accepts(context, operation));
    let handle = authority.issue(caller, context, operation)?;
    authority.save(&self.data_dir)?;
    Ok(handle)
  }

  pub fn revoke_board_invocation(&self, caller: &str, handle: &str) -> Result<(), String> {
    let _fence = crate::capability_authority::fence(&self.data_dir)?;
    let mut authority = crate::capability_authority::Authority::load(&self.data_dir)?;
    authority.revoke(caller, handle)?;
    authority.save(&self.data_dir)
  }

  /// Linearizes a short synchronous local effect with revocation and registry transitions.
  /// The effect must not re-enter PlatformState or await another process. Uses the same worker fence.
  pub fn with_board_authority<T>(&self, caller: &str, handle: &str, operation: &str, resource: &str,
      effect: impl FnOnce(&crate::capability_authority::InvocationContext) -> Result<T, String>) -> Result<T, String> {
    with_worker_board_authority(&self.data_dir, caller, handle, operation, resource, effect)
  }

  fn commit_registry(&self, registry: &mut CapabilityRegistry, mut next: CapabilityRegistry, changed_id: &str) -> Result<(), String> {
    use std::io::Write;
    // Legacy registry changes remain available on non-Unix targets; new worker authority requires Unix.
    #[cfg(unix)]
    let _fence = crate::capability_authority::fence(&self.data_dir)?;
    if load_registry(&self.data_dir)? != *registry {
      return Err("CONFLICT: installation changed; reload the host state".into());
    }
    if next.capabilities.iter().any(|item| item.manifest.id == changed_id) {
      next.generations.insert(changed_id.into(), crate::capability_authority::nonce()?);
    } else { next.generations.remove(changed_id); }
    let parent = self.data_dir.join(INSTALLED_CAPABILITIES_DIR);
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let path = parent.join(REGISTRY_FILE);
    let mut file = fs::File::create(path.with_extension("json.tmp")).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(path.with_extension("json.tmp"), &path).map_err(|e| e.to_string())?;
    // After rename the new state is visible even if the final durability acknowledgement fails.
    *registry = next;
    // The registry generation is the revocation authority. Grant-file cleanup is lazy so an
    // unavailable staging file cannot prevent disabling a package or leave its grants effective.
    #[cfg(unix)]
    fs::File::open(parent).and_then(|directory| directory.sync_all())
      .map_err(|_| "OUTCOME_UNKNOWN: registry changed but durability acknowledgement failed".to_string())?;
    Ok(())
  }

  pub fn capability_agent(&self) -> Result<String, String> {
    self.settings
      .read()
      .map(|settings| adopt_agent(&settings.capability_agent))
      .map_err(|_| "平台设置暂时不可用".to_string())
  }

  pub fn set_capability_agent(&self, agent: &str) -> Result<(), String> {
    validate_agent(agent)?;
    let mut settings = self
      .settings
      .write()
      .map_err(|_| "平台设置暂时不可用".to_string())?;
    let next = PlatformSettings {
      capability_agent: agent.to_string(),
    };
    persist_json(&self.data_dir.join(SETTINGS_FILE), &next)?;
    *settings = next;
    Ok(())
  }

  pub fn install_capability(
    &self,
    manifest: CapabilityManifest,
  ) -> Result<InstalledCapability, String> {
    validate_manifest(&manifest)?;
    let mut registry = self
      .registry
      .write()
      .map_err(|_| "能力注册表暂时不可用".to_string())?;
    if registry
      .capabilities
      .iter()
      .any(|capability| capability.manifest.id == manifest.id)
    {
      return Err("能力已经安装".into());
    }

    let installed = InstalledCapability {
      manifest,
      enabled: true,
      package_version: None,
      previous_package_version: None,
    };
    let mut next = registry.clone();
    next.capabilities.push(installed.clone());
    self.commit_registry(&mut registry, next, &installed.manifest.id)?;
    Ok(installed)
  }

  pub fn list_capabilities(&self) -> Result<Vec<InstalledCapability>, String> {
    self.registry
      .read()
      .map(|registry| registry.capabilities.clone())
      .map_err(|_| "能力注册表暂时不可用".to_string())
  }

  pub fn update_capability(
    &self,
    manifest: CapabilityManifest,
  ) -> Result<InstalledCapability, String> {
    validate_manifest(&manifest)?;
    let mut registry = self
      .registry
      .write()
      .map_err(|_| "能力注册表暂时不可用".to_string())?;
    let mut next = registry.clone();
    let capability = next
      .capabilities
      .iter_mut()
      .find(|capability| capability.manifest.id == manifest.id)
      .ok_or_else(|| "能力尚未安装".to_string())?;
    if capability.package_version.is_some() {
      return Err("外部能力包必须通过安装器更新".into());
    }
    capability.manifest = manifest;
    let updated = capability.clone();
    self.commit_registry(&mut registry, next, &updated.manifest.id)?;
    Ok(updated)
  }

  pub fn set_capability_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
    let mut registry = self
      .registry
      .write()
      .map_err(|_| "能力注册表暂时不可用".to_string())?;
    let mut next = registry.clone();
    let capability = next
      .capabilities
      .iter_mut()
      .find(|capability| capability.manifest.id == id)
      .ok_or_else(|| "能力尚未安装".to_string())?;
    capability.enabled = enabled;
    self.commit_registry(&mut registry, next, id)?;
    Ok(())
  }

  pub fn uninstall_capability(&self, id: &str) -> Result<(), String> {
    let mut registry = self
      .registry
      .write()
      .map_err(|_| "能力注册表暂时不可用".to_string())?;
    let mut next = registry.clone();
    let before = next.capabilities.len();
    next.capabilities.retain(|capability| capability.manifest.id != id);
    if next.capabilities.len() == before {
      return Err("能力尚未安装".into());
    }
    self.commit_registry(&mut registry, next, id)?;
    // Only package executables are removed; namespaced data and documents stay.
    let packages = self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(id);
    if packages.is_dir() { let _ = fs::remove_dir_all(packages); }
    Ok(())
  }

  pub fn read_tasks(&self) -> Result<Vec<serde_json::Value>, String> {
    load_json(&self.data_dir.join("tasks.json"))
  }

  pub fn write_tasks(&self, records: &[serde_json::Value]) -> Result<(), String> {
    persist_json(&self.data_dir.join("tasks.json"), &records)
  }

  pub fn read_task_board(&self) -> Result<serde_json::Value, String> {
    let _tasks = crate::task_worker::data_lock(&self.data_dir)?.ok_or("Task data maintenance is in progress")?;
    crate::task_goals::load(&self.data_dir)
  }

  pub fn write_task_board(&self, board: &serde_json::Value) -> Result<(), String> {
    let _tasks = crate::task_worker::data_lock(&self.data_dir)?.ok_or("Task data maintenance is in progress")?;
    crate::task_goals::save_legacy(&self.data_dir, &mut crate::task_goals::load(&self.data_dir)?, board.clone())
  }

  pub fn package_payload(&self, id: &str, previous: bool) -> Result<crate::package_installer::PackagePayload, String> {
    let registry = self.registry.read().map_err(|_| "能力注册表暂时不可用")?;
    let installed = registry.capabilities.iter().find(|item| item.manifest.id == id).ok_or("能力尚未安装")?;
    let version = if previous { &installed.previous_package_version } else { &installed.package_version };
    let version = version.as_ref().ok_or("没有可加载的独立能力包")?;
    self.read_package(id, version)
  }

  fn read_package(&self, id: &str, version: &str) -> Result<crate::package_installer::PackagePayload, String> {
    let path = self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(id).join(format!("{version}.json"));
    let bytes = fs::read(path).map_err(|_| "无法读取能力包")?;
    serde_json::from_slice(&bytes).map_err(|_| "能力包损坏".into())
  }

  pub fn activate_package(&self, package: crate::package_installer::PackagePayload, expected_version: Option<String>, rollback: bool) -> Result<InstalledCapability, String> {
    validate_manifest(&package.manifest)?;
    let mut registry = self.registry.write().map_err(|_| "能力注册表暂时不可用")?;
    let previous = registry.capabilities.iter().find(|item| item.manifest.id == package.manifest.id);
    if previous.map(|item| &item.manifest.version) != expected_version.as_ref() {
      return Err("能力版本已改变，请重新检查安装包".into());
    }
    if let Some(previous) = previous {
      if rollback {
        if previous.previous_package_version.as_ref() != Some(&package.manifest.version) { return Err("没有可回退的版本".into()); }
      } else if semver::Version::parse(&package.manifest.version).map_err(|_| "版本无效")?
        <= semver::Version::parse(&previous.manifest.version).map_err(|_| "版本无效")? {
        return Err("更新包版本必须高于当前版本".into());
      }
    }
    let installed = InstalledCapability {
      manifest: package.manifest.clone(),
      enabled: previous.map(|item| item.enabled).unwrap_or(true),
      package_version: Some(package.manifest.version.clone()),
      previous_package_version: previous.and_then(|item| item.package_version.clone()),
    };
    // Write the immutable package before switching the registry pointer. If
    // either write fails, the previous registry remains authoritative.
    let path = self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(&package.manifest.id).join(format!("{}.json", package.manifest.version));
    if path.exists() {
      let existing = self.read_package(&package.manifest.id, &package.manifest.version)?;
      if existing != package { return Err("同一版本的能力包内容不能改变".into()); }
    } else {
      persist_json(&path, &package)?;
    }
    let mut next = registry.clone();
    next.capabilities.retain(|item| item.manifest.id != package.manifest.id);
    next.capabilities.push(installed.clone());
    self.commit_registry(&mut registry, next, &installed.manifest.id)?;
    Ok(installed)
  }

  pub fn publish_document(
    &self,
    capability_id: &str,
    document: DocumentPublication,
  ) -> Result<LibraryDocumentMetadata, String> {
    self.authorize_permission(capability_id, CapabilityPermission::DocumentsPublish)?;
    let capability_name = self.active_capability_name(capability_id)?;
    document_library::publish_document(
      &self.data_dir,
      capability_id,
      &capability_name,
      document,
    )
  }

  pub fn grant_documents(&self, capability_id: &str, ids: Vec<String>, id: &str) -> Result<crate::document_grants::DocumentGrant, String> {
    crate::document_grants::grant(self, &self.data_dir, capability_id, ids, id)
  }
  pub fn revoke_document_grant(&self, id: &str) -> Result<(), String> {
    crate::document_grants::revoke(&self.data_dir, id)
  }

  pub(crate) fn prepare_document_grant(&self, id: &str) -> Result<(), String> {
    self.prepare_selection_grant(id, CapabilityPermission::DocumentsReadSelected)
  }
  pub(crate) fn prepare_selection_grant(&self, id: &str, permission: CapabilityPermission) -> Result<(), String> {
    let mut registry = self.registry.write().map_err(|_| "RESOURCE_UNAVAILABLE: registry unavailable")?;
    if !registry.capabilities.iter().any(|item| item.manifest.id == id && item.enabled
      && item.manifest.permissions.contains(&permission)) {
      return Err("PERMISSION_DENIED: selected resource access is not authorized".into());
    }
    if !registry.generations.contains_key(id) {
      let next = registry.clone();
      self.commit_registry(&mut registry, next, id)?;
    }
    Ok(())
  }

  // A short synchronous read/capture shares the lifecycle/revocation fence. Never await or re-enter.
  pub(crate) fn with_document_authority<T>(&self, id: &str,
      effect: impl FnOnce(&crate::capability_authority::InvocationContext) -> Result<T, String>) -> Result<T, String> {
    // Match the board worker's data -> authority order; restore uses the same cross-process data lock.
    let _data = crate::task_worker::data_lock(&self.data_dir)?.ok_or("RESOURCE_BUSY: user data is changing; retry later")?;
    crate::user_data::ensure_restore_complete(&self.data_dir)?;
    let _fence = crate::capability_authority::fence(&self.data_dir)?;
    let _library_fence = crate::library_management::fence(&self.data_dir)?;
    let _library = crate::library_management::DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
    effect(&self.document_context(id)?)
  }
  // Callers hold the native authority fence while using this current-registry snapshot.
  pub(crate) fn document_context(&self, id: &str) -> Result<crate::capability_authority::InvocationContext, String> {
    document_context(&self.data_dir, id)
  }
  pub fn document_grants(&self, capability_id: &str) -> Result<Vec<crate::document_grants::DocumentGrant>, String> {
    crate::document_grants::list(self, &self.data_dir, capability_id)
  }
  pub fn read_selected_document(&self, capability_id: &str, grant_id: &str, document_id: &str) -> Result<crate::document_grants::SelectedDocument, String> {
    crate::document_grants::read_selected(self, &self.data_dir, capability_id, grant_id, document_id)
  }
  pub fn read_document_source(&self, grant_id: &str, document_id: &str) -> Result<crate::document_grants::SelectedDocument, String> {
    crate::document_grants::read_source(&self.data_dir, grant_id, document_id)
  }
  pub fn search_library_content(&self, query: &str) -> Result<Vec<String>, String> {
    document_library::search_content(&self.data_dir, query)
  }

  pub fn list_library_documents(&self) -> Result<Vec<LibraryDocumentMetadata>, String> {
    document_library::list_documents(&self.data_dir)
  }

  pub fn read_library_document(&self, id: &str) -> Result<LibraryDocument, String> {
    document_library::read_document(&self.data_dir, id)
  }

  pub fn agent_for_capability(&self, id: &str) -> Result<String, String> {
    self.authorize_permission(id, CapabilityPermission::AiInvoke)?;
    self.capability_agent()
  }

  pub fn authorize_permission(
    &self,
    id: &str,
    permission: CapabilityPermission,
  ) -> Result<(), String> {
    let registry = self
      .registry
      .read()
      .map_err(|_| "能力注册表暂时不可用".to_string())?;
    let capability = registry
      .capabilities
      .iter()
      .find(|capability| capability.manifest.id == id)
      .ok_or_else(|| "能力尚未安装".to_string())?;
    if !capability.enabled {
      return Err("能力已停用".into());
    }
    if !capability
      .manifest
      .permissions
      .contains(&permission)
    {
      return Err(format!("能力未获得 {} 权限", permission.as_str()));
    }
    Ok(())
  }

  fn active_capability_name(&self, id: &str) -> Result<String, String> {
    let registry = self
      .registry
      .read()
      .map_err(|_| "能力注册表暂时不可用".to_string())?;
    let capability = registry
      .capabilities
      .iter()
      .find(|capability| capability.manifest.id == id)
      .ok_or_else(|| "能力尚未安装".to_string())?;
    if !capability.enabled {
      return Err("能力已停用".into());
    }
    Ok(capability.manifest.name.clone())
  }
}

impl CapabilityPermission {
  fn as_str(self) -> &'static str {
    match self {
      Self::Storage => "storage",
      Self::ActivityRead => "activity.read",
      Self::ActivityWrite => "activity.write",
      Self::AiInvoke => "ai.invoke",
      Self::CodexSessionsRead => "codex.sessions.read",
      Self::DocumentsPublish => "documents.publish",
      Self::DocumentsReadSelected => "documents.read-selected",
      Self::BoardCreate => "board.create",
      Self::BoardAttachDelivery => "board.attach-delivery",
      Self::ConversationsHandoff => "conversations.handoff",
    }
  }
}

fn validate_agent(agent: &str) -> Result<(), String> {
  match agent {
    "codex" | "claude" | "pi" => Ok(()),
    _ => Err("未知的 Agent".into()),
  }
}

/// A settings file written when Nooki still chose between its own endpoint and two ways of reaching
/// Codex names something that is no longer a choice. All three land on Codex, which is what every
/// one of them actually reached or replaced.
fn adopt_agent(stored: &str) -> String {
  match stored {
    "codex-api" | "codex-subscription" | "compatible-api" => DEFAULT_AGENT.into(),
    other => other.to_string(),
  }
}

pub fn validate_manifest(manifest: &CapabilityManifest) -> Result<(), String> {
  let id = manifest.id.as_str();
  if id.starts_with("workbench.") { return Err("The workbench namespace is reserved for platform features".into()); }
  if !id.contains('.')
    || id.split('.').any(|part| {
      part.is_empty()
        || !part
          .chars()
          .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
    })
  {
    return Err("能力 ID 必须使用小写反向域名格式".into());
  }
  if manifest.name.trim().is_empty()
    || manifest.version.trim().is_empty()
    || manifest.min_platform_version.trim().is_empty()
  {
    return Err("能力 Manifest 缺少名称或版本信息".into());
  }
  if manifest.entrypoints.is_empty() {
    return Err("能力 Manifest 至少需要一个入口".into());
  }
  semver::Version::parse(&manifest.version).map_err(|_| "能力版本必须是有效的 SemVer")?;
  let minimum = semver::Version::parse(&manifest.min_platform_version).map_err(|_| "最低平台版本无效")?;
  if manifest.permissions.contains(&CapabilityPermission::BoardAttachDelivery) && minimum < semver::Version::new(0, 8, 0) {
    return Err("board.attach-delivery requires minPlatformVersion 0.8.0 or newer".into());
  }
  if manifest.permissions.contains(&CapabilityPermission::ConversationsHandoff) && minimum < semver::Version::new(0, 10, 0) {
    return Err("conversations.handoff requires minPlatformVersion 0.10.0 or newer".into());
  }
  let current = semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|_| "平台版本无效")?;
  if minimum > current { return Err(format!("此能力需要 Nooki {minimum} 或更新版本")); }
  Ok(())
}

fn load_json<T>(path: &Path) -> Result<T, String>
where
  T: for<'de> Deserialize<'de> + Default,
{
  match fs::read(path) {
    Ok(source) => serde_json::from_slice(&source)
      .map_err(|_| format!("无法解析平台数据文件 {}", path.display())),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
    Err(_) => Err(format!("无法读取平台数据文件 {}", path.display())),
  }
}

fn persist_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
  let parent = path
    .parent()
    .ok_or_else(|| "平台数据目录无效".to_string())?;
  fs::create_dir_all(parent).map_err(|_| "无法创建平台数据目录".to_string())?;
  let source = serde_json::to_vec_pretty(value)
    .map_err(|_| "无法序列化平台数据".to_string())?;
  let temporary = path.with_extension("json.tmp");
  fs::write(&temporary, source).map_err(|_| "无法写入平台数据".to_string())?;
  fs::rename(&temporary, path).map_err(|_| "无法保存平台数据".to_string())
}

fn load_registry(root: &Path) -> Result<CapabilityRegistry, String> {
  let installed = root.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE);
  let path = if installed.try_exists().map_err(|e| e.to_string())? { installed } else { root.join(REGISTRY_FILE) };
  load_json(&path)
}

impl CapabilityRegistry {
  fn accepts(&self, context: &crate::capability_authority::InvocationContext, operation: &str) -> bool {
    self.generations.get(&context.capability_id) == Some(&context.generation)
      && self.capabilities.iter().any(|item| item.manifest.id == context.capability_id
        && item.manifest.version == context.capability_version && item.enabled
        && board_permission(operation).is_some_and(|permission| item.manifest.permissions.contains(&permission)))
  }
}
fn board_permission(operation: &str) -> Option<CapabilityPermission> {
  match operation { "board.create" => Some(CapabilityPermission::BoardCreate), "board.attachDelivery" => Some(CapabilityPermission::BoardAttachDelivery), _ => None }
}

// Caller holds the authority fence; this also serves worker-side document effects without re-locking.
pub(crate) fn document_context(root: &Path, id: &str) -> Result<crate::capability_authority::InvocationContext, String> {
  selection_context(root, id, CapabilityPermission::DocumentsReadSelected)
}
pub(crate) fn selection_context(root: &Path, id: &str, permission: CapabilityPermission) -> Result<crate::capability_authority::InvocationContext, String> {
  let current = load_registry(root)?;
  let installed = current.capabilities.iter().find(|item| item.manifest.id == id && item.enabled
    && item.manifest.permissions.contains(&permission))
    .ok_or("PERMISSION_DENIED: selected resource access is not authorized")?;
  let generation = current.generations.get(id).ok_or("PERMISSION_DENIED: select resources again for this installation")?;
  Ok(crate::capability_authority::InvocationContext { capability_id: id.into(),
    capability_version: installed.manifest.version.clone(), generation: generation.clone() })
}

/// Native worker effect boundary; never a renderer issuance endpoint. The caller must be supplied
/// by the trusted host controller, not a package body. Do not await IPC or re-enter authority here.
pub fn with_worker_board_authority<T>(root: &Path, caller: &str, handle: &str, operation: &str, resource: &str,
    effect: impl FnOnce(&crate::capability_authority::InvocationContext) -> Result<T, String>) -> Result<T, String> {
  let _fence = crate::capability_authority::fence(root)?;
  let authority = crate::capability_authority::Authority::load(root)?;
  let context = authority.context(caller, handle, operation, resource)?;
  if !load_registry(root)?.accepts(context, operation) { return Err("PERMISSION_DENIED: stale installation generation".into()); }
  effect(context)
}
