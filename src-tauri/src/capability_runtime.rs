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
const DEFAULT_PROVIDER: &str = "codex-api";

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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CapabilityRegistry {
  capabilities: Vec<InstalledCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformSettings {
  selected_provider: String,
}

impl Default for PlatformSettings {
  fn default() -> Self {
    Self {
      selected_provider: DEFAULT_PROVIDER.into(),
    }
  }
}

pub struct PlatformState {
  data_dir: PathBuf,
  settings: RwLock<PlatformSettings>,
  registry: RwLock<CapabilityRegistry>,
}

impl PlatformState {
  pub fn load(data_dir: PathBuf) -> Result<Self, String> {
    let settings = load_json(&data_dir.join(SETTINGS_FILE))?;
    let installed_registry_path = data_dir.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE);
    let registry_path = if installed_registry_path.is_file() {
      installed_registry_path
    } else {
      // Keep existing installations visible while moving the registry into
      // the isolated installed-capabilities directory.
      data_dir.join(REGISTRY_FILE)
    };
    let registry = load_json(&registry_path)?;
    Ok(Self {
      data_dir,
      settings: RwLock::new(settings),
      registry: RwLock::new(registry),
    })
  }

  pub fn selected_provider(&self) -> Result<String, String> {
    self.settings
      .read()
      .map(|settings| settings.selected_provider.clone())
      .map_err(|_| "平台设置暂时不可用".to_string())
  }

  pub fn set_selected_provider(&self, provider: &str) -> Result<(), String> {
    validate_provider(provider)?;
    let mut settings = self
      .settings
      .write()
      .map_err(|_| "平台设置暂时不可用".to_string())?;
    let next = PlatformSettings {
      selected_provider: provider.to_string(),
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
    persist_json(
      &self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE),
      &next,
    )?;
    *registry = next;
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
    persist_json(
      &self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE),
      &next,
    )?;
    *registry = next;
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
    persist_json(
      &self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE),
      &next,
    )?;
    *registry = next;
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
    persist_json(
      &self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE),
      &next,
    )?;
    *registry = next;
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
    persist_json(&self.data_dir.join(INSTALLED_CAPABILITIES_DIR).join(REGISTRY_FILE), &next)?;
    *registry = next;
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

  pub fn provider_for_capability(&self, id: &str) -> Result<String, String> {
    self.authorize_permission(id, CapabilityPermission::AiInvoke)?;
    self.selected_provider()
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
    }
  }
}

fn validate_provider(provider: &str) -> Result<(), String> {
  match provider {
    "codex-api" | "codex-subscription" | "compatible-api" => Ok(()),
    _ => Err("未知的 Provider 类型".into()),
  }
}

pub fn validate_manifest(manifest: &CapabilityManifest) -> Result<(), String> {
  let id = manifest.id.as_str();
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
  let current = semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|_| "平台版本无效")?;
  if minimum > current { return Err(format!("此能力需要 Workbench {minimum} 或更新版本")); }
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
