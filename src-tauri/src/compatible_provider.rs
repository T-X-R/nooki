//! User-configured compatible endpoints.
//!
//! Nooki keeps one managed adapter for every model vendor. This module owns the
//! endpoints a user configured by hand, including the credential. Nooki ships no
//! vendor list: the user states the base URL, model and protocol themselves.
//! Secrets stay in the desktop host: the interface only ever receives a masked
//! hint, and Capability Packages never see the endpoint list at all.

use crate::managed_provider::{ManagedProvider, WireApi};
use serde::{Deserialize, Serialize};
use std::{
  fs,
  path::{Path, PathBuf},
  sync::RwLock,
};

const ENDPOINTS_FILE: &str = "compatible-endpoints.json";
const MAX_ENDPOINTS: usize = 20;
const MAX_FIELD: usize = 200;

/// The stored form of an endpoint, including its secret. Only this module and
/// the on-disk file ever see `api_key`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEndpoint {
  id: String,
  label: String,
  base_url: String,
  model: String,
  wire_api: String,
  #[serde(default, skip_serializing_if = "String::is_empty")]
  api_key_env: String,
  #[serde(default, skip_serializing_if = "String::is_empty")]
  api_key: String,
  #[serde(default, skip_serializing_if = "String::is_empty")]
  reasoning_effort: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointStore {
  #[serde(default)]
  selected_id: String,
  #[serde(default)]
  endpoints: Vec<StoredEndpoint>,
}

/// The endpoint shape sent to the interface. It carries a credential hint but
/// never the credential itself.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointView {
  pub id: String,
  pub label: String,
  pub base_url: String,
  pub model: String,
  pub wire_api: String,
  pub api_key_env: String,
  pub reasoning_effort: String,
  pub credential: String,
  pub credential_hint: String,
  pub selected: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointsSnapshot {
  pub endpoints: Vec<EndpointView>,
  pub selected_id: String,
}

/// The interface payload for creating or updating an endpoint. An absent or
/// blank `api_key` keeps the stored credential untouched.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInput {
  #[serde(default)]
  pub id: String,
  #[serde(default)]
  pub label: String,
  #[serde(default)]
  pub base_url: String,
  #[serde(default)]
  pub model: String,
  #[serde(default)]
  pub wire_api: String,
  #[serde(default)]
  pub api_key_env: String,
  #[serde(default)]
  pub api_key: Option<String>,
  #[serde(default)]
  pub reasoning_effort: String,
}

pub struct CompatibleEndpoints {
  path: PathBuf,
  store: RwLock<EndpointStore>,
}

impl CompatibleEndpoints {
  pub fn load(data_dir: &Path) -> Result<Self, String> {
    let path = data_dir.join(ENDPOINTS_FILE);
    let store = match fs::read(&path) {
      Ok(source) => serde_json::from_slice(&source).map_err(|_| "兼容端点配置文件已损坏".to_string())?,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => EndpointStore::default(),
      Err(_) => return Err("无法读取兼容端点配置".into()),
    };
    Ok(Self { path, store: RwLock::new(store) })
  }

  pub fn snapshot(&self) -> Result<EndpointsSnapshot, String> {
    let store = self.store.read().map_err(|_| "兼容端点配置暂时不可用".to_string())?;
    Ok(snapshot(&store))
  }

  pub fn save(&self, input: EndpointInput) -> Result<EndpointsSnapshot, String> {
    let mut store = self.store.write().map_err(|_| "兼容端点配置暂时不可用".to_string())?;
    let mut next = store.clone();
    let existing = next.endpoints.iter().position(|endpoint| endpoint.id == input.id);
    if input.id.is_empty() && next.endpoints.len() >= MAX_ENDPOINTS {
      return Err("兼容端点数量已达上限".into());
    }
    if !input.id.is_empty() && existing.is_none() {
      return Err("兼容端点不存在".into());
    }

    let previous = existing.map(|index| next.endpoints[index].clone()).unwrap_or_default();
    let endpoint = normalize(input, &previous)?;
    match existing {
      Some(index) => next.endpoints[index] = endpoint.clone(),
      None => next.endpoints.push(endpoint.clone()),
    }
    if next.selected_id.is_empty() || existing.is_none() {
      next.selected_id = endpoint.id.clone();
    }

    persist(&self.path, &next)?;
    *store = next;
    Ok(snapshot(&store))
  }

  pub fn remove(&self, id: &str) -> Result<EndpointsSnapshot, String> {
    let mut store = self.store.write().map_err(|_| "兼容端点配置暂时不可用".to_string())?;
    let mut next = store.clone();
    let before = next.endpoints.len();
    next.endpoints.retain(|endpoint| endpoint.id != id);
    if next.endpoints.len() == before {
      return Err("兼容端点不存在".into());
    }
    if next.selected_id == id {
      next.selected_id = next.endpoints.first().map(|endpoint| endpoint.id.clone()).unwrap_or_default();
    }
    persist(&self.path, &next)?;
    *store = next;
    Ok(snapshot(&store))
  }

  pub fn select(&self, id: &str) -> Result<EndpointsSnapshot, String> {
    let mut store = self.store.write().map_err(|_| "兼容端点配置暂时不可用".to_string())?;
    if !store.endpoints.iter().any(|endpoint| endpoint.id == id) {
      return Err("兼容端点不存在".into());
    }
    let mut next = store.clone();
    next.selected_id = id.to_string();
    persist(&self.path, &next)?;
    *store = next;
    Ok(snapshot(&store))
  }

  /// The endpoint the Model Gateway should call, with its credential resolved.
  pub fn active_provider(&self) -> Result<ManagedProvider, String> {
    let store = self.store.read().map_err(|_| "兼容端点配置暂时不可用".to_string())?;
    let endpoint = active(&store).ok_or_else(|| "兼容端点尚未配置".to_string())?;
    provider(endpoint)
  }

  /// A short description of the active endpoint for the settings page.
  pub fn active_summary(&self) -> Result<Option<(String, String, bool)>, String> {
    let store = self.store.read().map_err(|_| "兼容端点配置暂时不可用".to_string())?;
    Ok(active(&store).map(|endpoint| {
      (endpoint.label.clone(), endpoint.model.clone(), resolve_credential(endpoint).is_ok())
    }))
  }
}

fn active(store: &EndpointStore) -> Option<&StoredEndpoint> {
  store
    .endpoints
    .iter()
    .find(|endpoint| endpoint.id == store.selected_id)
    .or_else(|| store.endpoints.first())
}

fn provider(endpoint: &StoredEndpoint) -> Result<ManagedProvider, String> {
  let wire_api = WireApi::parse(&endpoint.wire_api).ok_or_else(|| "兼容端点的协议无效".to_string())?;
  Ok(ManagedProvider::new(
    endpoint.label.clone(),
    endpoint.model.clone(),
    endpoint.base_url.clone(),
    resolve_credential(endpoint)?,
    wire_api,
    Some(endpoint.reasoning_effort.clone()).filter(|effort| !effort.is_empty()),
  ))
}

fn resolve_credential(endpoint: &StoredEndpoint) -> Result<String, String> {
  if !endpoint.api_key_env.is_empty() {
    return std::env::var(&endpoint.api_key_env)
      .ok()
      .filter(|value| !value.trim().is_empty())
      .ok_or_else(|| format!("桌面宿主未获取到环境变量 {}", endpoint.api_key_env));
  }
  if !endpoint.api_key.is_empty() {
    return Ok(endpoint.api_key.clone());
  }
  // A local runtime such as Ollama accepts any placeholder credential.
  if is_loopback(&endpoint.base_url) {
    return Ok("local".into());
  }
  Err("兼容端点缺少可用凭据".into())
}

fn is_loopback(base_url: &str) -> bool {
  reqwest::Url::parse(base_url)
    .ok()
    .and_then(|url| url.host_str().map(str::to_string))
    .is_some_and(|host| host == "localhost" || host == "127.0.0.1" || host == "[::1]")
}

fn snapshot(store: &EndpointStore) -> EndpointsSnapshot {
  let selected_id = active(store).map(|endpoint| endpoint.id.clone()).unwrap_or_default();
  EndpointsSnapshot {
    endpoints: store
      .endpoints
      .iter()
      .map(|endpoint| EndpointView {
        id: endpoint.id.clone(),
        label: endpoint.label.clone(),
        base_url: endpoint.base_url.clone(),
        model: endpoint.model.clone(),
        wire_api: endpoint.wire_api.clone(),
        api_key_env: endpoint.api_key_env.clone(),
        reasoning_effort: endpoint.reasoning_effort.clone(),
        credential: credential_kind(endpoint).into(),
        credential_hint: credential_hint(endpoint),
        selected: endpoint.id == selected_id,
      })
      .collect(),
    selected_id,
  }
}

fn credential_kind(endpoint: &StoredEndpoint) -> &'static str {
  if !endpoint.api_key_env.is_empty() {
    "environment"
  } else if !endpoint.api_key.is_empty() {
    "stored"
  } else if is_loopback(&endpoint.base_url) {
    "local"
  } else {
    "missing"
  }
}

/// Shows just enough of a key to recognize it, never enough to reuse it.
fn credential_hint(endpoint: &StoredEndpoint) -> String {
  if !endpoint.api_key_env.is_empty() {
    return endpoint.api_key_env.clone();
  }
  let key = endpoint.api_key.trim();
  if key.is_empty() {
    return String::new();
  }
  let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
  format!("••••{tail}")
}

fn normalize(input: EndpointInput, previous: &StoredEndpoint) -> Result<StoredEndpoint, String> {
  let wire_api = field(&input.wire_api, "chat");
  if WireApi::parse(&wire_api).is_none() {
    return Err("兼容端点的协议无效".into());
  }
  let base_url = input.base_url.trim().trim_end_matches('/').to_string();
  if base_url.is_empty() {
    return Err("兼容端点缺少 base_url".into());
  }
  validate_base_url(&base_url)?;
  let model = input.model.trim().to_string();
  if model.is_empty() {
    return Err("兼容端点缺少模型名称".into());
  }
  let label = field(&input.label, &model);
  let api_key_env = input.api_key_env.trim().to_string();
  if [&label, &base_url, &model, &api_key_env].iter().any(|value| value.chars().count() > MAX_FIELD) {
    return Err("兼容端点的配置字段过长".into());
  }

  let api_key = match input.api_key.as_deref().map(str::trim) {
    // Switching to an environment reference drops any previously stored key.
    _ if !api_key_env.is_empty() => String::new(),
    Some(key) if !key.is_empty() => key.to_string(),
    _ => previous.api_key.clone(),
  };

  let endpoint = StoredEndpoint {
    id: if input.id.is_empty() { next_id() } else { input.id },
    label,
    base_url,
    model,
    wire_api,
    api_key_env,
    api_key,
    reasoning_effort: input.reasoning_effort.trim().to_string(),
  };
  resolve_credential(&endpoint)?;
  Ok(endpoint)
}

fn validate_base_url(base_url: &str) -> Result<(), String> {
  let url = reqwest::Url::parse(base_url).map_err(|_| "兼容端点的 base_url 无效".to_string())?;
  if !matches!(url.scheme(), "http" | "https") || url.username() != "" || url.password().is_some() {
    return Err("兼容端点的 base_url 无效".into());
  }
  if url.query().is_some() || url.fragment().is_some() {
    return Err("兼容端点的 base_url 不能包含查询参数或片段".into());
  }
  Ok(())
}

fn field(value: &str, fallback: &str) -> String {
  let value = value.trim();
  if value.is_empty() { fallback.trim().to_string() } else { value.to_string() }
}

fn next_id() -> String {
  format!("endpoint-{}", chrono::Utc::now().timestamp_micros())
}

fn persist(path: &Path, store: &EndpointStore) -> Result<(), String> {
  let parent = path.parent().ok_or_else(|| "平台数据目录无效".to_string())?;
  fs::create_dir_all(parent).map_err(|_| "无法创建平台数据目录".to_string())?;
  let source = serde_json::to_vec_pretty(store).map_err(|_| "无法序列化兼容端点配置".to_string())?;
  let temporary = path.with_extension("json.tmp");
  fs::write(&temporary, source).map_err(|_| "无法写入兼容端点配置".to_string())?;
  restrict(&temporary);
  fs::rename(&temporary, path).map_err(|_| "无法保存兼容端点配置".to_string())
}

#[cfg(unix)]
fn restrict(path: &Path) {
  use std::os::unix::fs::PermissionsExt;
  // The file holds API keys, so keep it readable by the current user only.
  let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_path: &Path) {}

#[cfg(test)]
mod tests {
  use super::*;

  fn temporary_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nooki-endpoints-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn input(model: &str, key: &str) -> EndpointInput {
    EndpointInput {
      label: "Vendor".into(),
      base_url: "https://api.example.com/v1".into(),
      model: model.into(),
      wire_api: "chat".into(),
      api_key: Some(key.into()),
      ..EndpointInput::default()
    }
  }

  #[test]
  fn saves_selects_and_masks_credentials() {
    let dir = temporary_dir("save");
    let endpoints = CompatibleEndpoints::load(&dir).unwrap();
    let snapshot = endpoints.save(input("model-a", "sk-secret-1234")).unwrap();

    assert_eq!(snapshot.endpoints.len(), 1);
    let saved = &snapshot.endpoints[0];
    assert_eq!(saved.credential, "stored");
    assert_eq!(saved.credential_hint, "••••1234");
    assert!(saved.selected);
    assert_eq!(snapshot.selected_id, saved.id);
    // The serialized interface payload must never contain the raw key.
    let payload = serde_json::to_string(&snapshot).unwrap();
    assert!(!payload.contains("sk-secret-1234"), "{payload}");

    // An update without a key keeps the stored credential.
    let mut update = input("model-b", "");
    update.id = saved.id.clone();
    let snapshot = endpoints.save(update).unwrap();
    assert_eq!(snapshot.endpoints[0].model, "model-b");
    assert_eq!(snapshot.endpoints[0].credential_hint, "••••1234");

    // The stored file keeps the secret for the host and stays private.
    let stored = fs::read_to_string(dir.join(ENDPOINTS_FILE)).unwrap();
    assert!(stored.contains("sk-secret-1234"));
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mode = fs::metadata(dir.join(ENDPOINTS_FILE)).unwrap().permissions().mode();
      assert_eq!(mode & 0o777, 0o600);
    }

    // Reloading keeps the selection and the resolved provider usable.
    let reloaded = CompatibleEndpoints::load(&dir).unwrap();
    assert_eq!(reloaded.snapshot().unwrap().selected_id, saved.id);
    assert!(reloaded.active_provider().is_ok());
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn rejects_invalid_endpoints() {
    let dir = temporary_dir("invalid");
    let endpoints = CompatibleEndpoints::load(&dir).unwrap();

    let mut missing_model = input("", "sk-1");
    missing_model.model = "  ".into();
    assert!(endpoints.save(missing_model).is_err());

    let mut bad_url = input("model-a", "sk-1");
    bad_url.base_url = "ftp://example.com".into();
    assert!(endpoints.save(bad_url).is_err());

    let mut bad_wire = input("model-a", "sk-1");
    bad_wire.wire_api = "grpc".into();
    assert!(endpoints.save(bad_wire).is_err());

    let mut no_credential = input("model-a", "");
    no_credential.api_key = None;
    assert_eq!(endpoints.save(no_credential).unwrap_err(), "兼容端点缺少可用凭据");

    assert!(endpoints.remove("missing").is_err());
    assert!(endpoints.select("missing").is_err());
    assert!(endpoints.active_provider().is_err());
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn supports_environment_and_local_credentials() {
    let dir = temporary_dir("credentials");
    let endpoints = CompatibleEndpoints::load(&dir).unwrap();

    let mut remote = input("model-a", "");
    remote.wire_api = "anthropic".into();
    remote.api_key_env = "NOOKI_TEST_MODEL_KEY".into();
    std::env::set_var("NOOKI_TEST_MODEL_KEY", "sk-env");
    let snapshot = endpoints.save(remote).unwrap();
    assert_eq!(snapshot.endpoints[0].credential, "environment");
    assert_eq!(snapshot.endpoints[0].credential_hint, "NOOKI_TEST_MODEL_KEY");

    let mut local = input("model-b", "");
    local.label = "Local runtime".into();
    local.base_url = "http://127.0.0.1:11434/v1".into();
    local.api_key = None;
    let snapshot = endpoints.save(local).unwrap();
    assert_eq!(snapshot.endpoints.len(), 2);
    assert_eq!(snapshot.endpoints[1].credential, "local");

    // A newly added endpoint becomes the active one.
    let first = snapshot.endpoints[0].id.clone();
    assert_eq!(snapshot.selected_id, snapshot.endpoints[1].id);
    let snapshot = endpoints.select(&first).unwrap();
    assert!(snapshot.endpoints[0].selected);
    let snapshot = endpoints.select(&snapshot.endpoints[1].id).unwrap();
    assert!(snapshot.endpoints[1].selected);
    let summary = endpoints.active_summary().unwrap().unwrap();
    assert_eq!(summary, ("Local runtime".into(), "model-b".into(), true));

    // Removing the selected endpoint falls back to the remaining one.
    let snapshot = endpoints.remove(&snapshot.endpoints[1].id).unwrap();
    assert_eq!(snapshot.selected_id, first);
    std::env::remove_var("NOOKI_TEST_MODEL_KEY");
    fs::remove_dir_all(dir).unwrap();
  }
}
