pub mod codex_conversations;
pub mod conversation_documents;
pub mod source_snapshots;
pub mod document_grants;
pub mod capability_runtime;
pub mod codex_session_source;
pub mod document_library;
pub mod library_management;
pub mod user_data;
pub mod managed_provider;
pub mod package_installer;
pub mod task_execution;
pub mod developer_integration;

use capability_runtime::{CapabilityManifest, InstalledCapability, PlatformState};
use codex_session_source::{read_daily_files, CodexDailySessionFiles};
use document_library::{DocumentPublication, LibraryDocument, LibraryDocumentMetadata};
use managed_provider::{invoke, load_codex_api_profile, ModelResult};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const MAX_LOG_FILE_SIZE: u128 = 2_000_000;
const LOG_FILES_TO_KEEP: usize = 3;

#[derive(Debug, Serialize)]
struct ProviderStatus {
  kind: String,
  state: String,
  label: String,
  detail: String,
}

#[derive(Debug, Deserialize)]
struct CapabilityAiRequest {
  #[serde(rename = "capabilityId")]
  capability_id: String,
  input: String,
  #[serde(rename = "executionId")]
  execution_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CapabilityCodexSessionsRequest {
  #[serde(rename = "capabilityId")]
  capability_id: String,
}

#[derive(Debug, Deserialize)]
struct CapabilityDocumentPublishRequest {
  #[serde(rename = "capabilityId")]
  capability_id: String,
  document: DocumentPublication,
}

fn codex_home() -> std::path::PathBuf {
  if let Some(path) = std::env::var_os("CODEX_HOME") {
    if !path.is_empty() {
      return std::path::PathBuf::from(path);
    }
  }

  std::env::var_os("HOME")
    .map(std::path::PathBuf::from)
    .map(|home| home.join(".codex"))
    .unwrap_or_else(|| std::path::PathBuf::from(".codex"))
}

fn codex_binary() -> String {
  if let Ok(path) = std::env::var("CODEX_BIN") {
    if !path.trim().is_empty() {
      return path;
    }
  }

  let mut candidates = Vec::new();
  if let Some(home) = std::env::var_os("HOME") {
    let home = std::path::PathBuf::from(home);
    candidates.push(home.join(".hermes/node/bin/codex"));
    candidates.push(home.join(".local/bin/codex"));
    candidates.push(home.join(".npm-global/bin/codex"));
  }
  candidates.push(std::path::PathBuf::from("/opt/homebrew/bin/codex"));
  candidates.push(std::path::PathBuf::from("/usr/local/bin/codex"));

  candidates
    .into_iter()
    .find(|path| path.is_file())
    .map(|path| path.to_string_lossy().into_owned())
    .unwrap_or_else(|| "codex".into())
}

fn codex_command(binary: &str) -> std::io::Result<std::process::Command> {
  let mut command = std::process::Command::new(binary);
  // Finder-launched apps may lack the Node directory required by the Codex CLI launcher.
  if let Some(parent) = std::path::Path::new(binary).parent().filter(|path| !path.as_os_str().is_empty()) {
    let inherited = std::env::var_os("PATH").unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin".into());
    let paths = std::iter::once(parent.to_path_buf()).chain(std::env::split_paths(&inherited));
    command.env("PATH", std::env::join_paths(paths).map_err(std::io::Error::other)?);
  }
  Ok(command)
}

fn is_english(language: &str) -> bool {
  language == "en"
}

fn localize_provider_error(detail: String, english: bool) -> String {
  if !english {
    return detail;
  }

  if let Some(env_key) = detail.strip_prefix("桌面宿主未获取到环境变量 ") {
    return format!("The desktop host could not read environment variable {env_key}");
  }
  if let Some(code) = detail
    .strip_prefix("Provider 请求失败（HTTP ")
    .and_then(|value| value.strip_suffix("）"))
  {
    return format!("Provider request failed (HTTP {code})");
  }

  match detail.as_str() {
    "未找到或无法读取 ~/.codex/api.config.toml" => {
      "Could not find or read ~/.codex/api.config.toml".into()
    }
    "API 配置文件格式无效" => "The API configuration file is invalid".into(),
    "API 配置引用的 model_provider 不存在" => {
      "The configured model_provider does not exist".into()
    }
    "API 配置缺少 model" => "The API configuration is missing model".into(),
    "API 配置缺少 base_url" => "The API configuration is missing base_url".into(),
    "当前仅支持 wire_api = \"responses\"" => {
      "Only wire_api = \"responses\" is currently supported".into()
    }
    "API 配置缺少可用凭据" => "The API configuration has no usable credential".into(),
    "无法初始化 Provider 连接" => "Could not initialize the Provider connection".into(),
    "无法连接 Provider 端点" => "Could not connect to the Provider endpoint".into(),
    "无法连接 Provider 端点（TLS 或网络握手失败，已重试）" => {
      "Could not connect to the Provider endpoint after retrying the TLS or network handshake".into()
    }
    "连接 Provider 端点超时" => "The Provider connection timed out".into(),
    "Provider 生成响应超时" => "The Provider response timed out".into(),
    "Provider 请求发送失败" => "Could not send the Provider request".into(),
    "读取 Provider 响应失败" => "Could not read the Provider response".into(),
    "Provider 拒绝了当前凭据" => "The Provider rejected the current credential".into(),
    "Provider 不支持配置的 Responses 端点" => {
      "The Provider does not support the configured Responses endpoint".into()
    }
    "Provider 当前请求过多或额度不足" => {
      "The Provider is rate limited or has insufficient quota".into()
    }
    "Provider 返回了无法解析的响应" => "The Provider returned an invalid response".into(),
    "Provider 响应中没有文本结果" => "The Provider response contains no text output".into(),
    "API 配置中的 base_url 无效" => "The configured base_url is invalid".into(),
    "API 配置中的 base_url 不能包含查询参数或片段" => {
      "The configured base_url cannot contain a query or fragment".into()
    }
    "兼容端点尚未接入，请选择 API key 托管或 Codex 订阅" => {
      "Compatible endpoints are not connected yet. Select Managed API key or Codex subscription".into()
    }
    "未知的 Provider 类型" => "Unknown Provider type".into(),
    "Codex Agent 未返回文本结果" => "The Codex agent returned no text output".into(),
    _ => "The Provider is unavailable. Check its configuration".into(),
  }
}

#[tauri::command]
fn provider_status(kind: String, language: String) -> ProviderStatus {
  let english = is_english(&language);
  let label = match (kind.as_str(), english) {
    ("codex-api", true) => "Managed API key",
    ("codex-subscription", true) => "Codex subscription",
    ("compatible-api", true) => "Compatible endpoint",
    ("codex-api", false) => "API key 托管",
    ("codex-subscription", false) => "Codex 订阅",
    ("compatible-api", false) => "兼容端点",
    (_, true) => "Managed API key",
    (_, false) => "API key 托管",
  };

  match kind.as_str() {
    "codex-api" => {
      match load_codex_api_profile(&codex_home()) {
        Ok(provider) => ProviderStatus {
          kind,
          state: "configured".into(),
          label: label.into(),
          detail: if english {
            format!("Managed {} · {}", provider.name, provider.model)
          } else {
            format!("已托管 {} · {}", provider.name, provider.model)
          },
        },
        Err(detail) => ProviderStatus {
          kind,
          state: "error".into(),
          label: label.into(),
          detail: localize_provider_error(detail, english),
        },
      }
    }
    "codex-subscription" => {
      let config_path = codex_home().join("config.toml");
      if !config_path.is_file() {
        return ProviderStatus {
          kind,
          state: "error".into(),
          label: label.into(),
          detail: if english {
            "Could not find ~/.codex/config.toml".into()
          } else {
            "未找到 ~/.codex/config.toml".into()
          },
        };
      }

      match codex_command(&codex_binary())
        .and_then(|mut command| command.args(["login", "status"]).output())
      {
        Ok(output) if output.status.success() => ProviderStatus {
          kind,
          state: "ready".into(),
          label: label.into(),
          detail: if english {
            "The Codex login session is available and will use the default config.toml".into()
          } else {
            "Codex 订阅登录态可用，Agent 将使用默认 config.toml".into()
          },
        },
        Ok(_) | Err(_) => ProviderStatus {
          kind,
          state: "error".into(),
          label: label.into(),
          detail: if english {
            "The Codex login session is unavailable. Run codex login in a terminal".into()
          } else {
            "Codex 订阅登录态不可用，请在终端执行 codex login".into()
          },
        },
      }
    }
    _ => ProviderStatus {
      kind,
      state: "preview".into(),
      label: label.into(),
      detail: if english {
        "Compatible endpoint configuration is coming to platform settings".into()
      } else {
        "兼容端点将在平台设置中配置".into()
      },
    },
  }
}

#[tauri::command]
async fn provider_health_check(
  language: String,
  state: tauri::State<'_, PlatformState>,
) -> Result<ProviderStatus, String> {
  let english = is_english(&language);
  let kind = match state.selected_provider() {
    Ok(kind) => kind,
    Err(detail) => {
      return Ok(ProviderStatus {
        kind: "unknown".into(),
        state: "error".into(),
        label: "AI Provider".into(),
        detail: localize_provider_error(detail, english),
      })
    }
  };
  if kind != "codex-api" {
    return Ok(provider_status(kind, language));
  }

  let label = if english { "Managed API key" } else { "API key 托管" };
  let provider = match load_codex_api_profile(&codex_home()) {
    Ok(provider) => provider,
    Err(detail) => {
      return Ok(ProviderStatus {
        kind,
        state: "error".into(),
        label: label.into(),
        detail: localize_provider_error(detail, english),
      })
    }
  };
  let provider_name = provider.name.clone();
  let model = provider.model.clone();

  Ok(match invoke(provider, "Reply with exactly OK.").await {
    Ok(_) => ProviderStatus {
      kind,
      state: "ready".into(),
      label: label.into(),
      detail: if english {
        format!("Connected · {provider_name} · {model}")
      } else {
        format!("连接正常 · {provider_name} · {model}")
      },
    },
    Err(detail) => ProviderStatus {
      kind,
      state: "error".into(),
      label: label.into(),
      detail: localize_provider_error(detail, english),
    },
  })
}

#[tauri::command]
fn get_selected_provider(state: tauri::State<'_, PlatformState>) -> Result<String, String> {
  state.selected_provider()
}

#[tauri::command]
fn set_selected_provider(
  kind: String,
  state: tauri::State<'_, PlatformState>,
) -> Result<(), String> {
  state.set_selected_provider(&kind)
}

#[tauri::command]
fn install_capability(
  manifest: CapabilityManifest,
  state: tauri::State<'_, PlatformState>,
) -> Result<InstalledCapability, String> {
  state.install_capability(manifest)
}

#[tauri::command]
fn update_capability(
  manifest: CapabilityManifest,
  state: tauri::State<'_, PlatformState>,
) -> Result<InstalledCapability, String> {
  state.update_capability(manifest)
}

#[tauri::command]
fn list_capabilities(
  state: tauri::State<'_, PlatformState>,
) -> Result<Vec<InstalledCapability>, String> {
  state.list_capabilities()
}

#[tauri::command]
fn set_capability_enabled(
  id: String,
  enabled: bool,
  state: tauri::State<'_, PlatformState>,
) -> Result<(), String> {
  state.set_capability_enabled(&id, enabled)
}

#[tauri::command]
fn uninstall_capability(
  id: String,
  state: tauri::State<'_, PlatformState>,
) -> Result<(), String> {
  state.uninstall_capability(&id)
}

#[tauri::command]
fn capability_documents_publish(
  request: CapabilityDocumentPublishRequest,
  state: tauri::State<'_, PlatformState>,
) -> Result<(), String> {
  let capability_id = request.capability_id;
  let result = state.publish_document(&capability_id, request.document);
  match &result {
    Ok(document) => log::info!(
      target: "workbench::documents",
      "document.publish capability_id={capability_id} document_id={} bytes={}",
      document.id,
      document.size_bytes,
    ),
    Err(_) => log::warn!(
      target: "workbench::documents",
      "document.publish_error capability_id={capability_id}",
    ),
  }
  result.map(|_| ())
}

#[tauri::command]
async fn conversation_list(cursor: Option<String>, archived: Option<bool>, bridge: tauri::State<'_, codex_conversations::CodexConversations>) -> Result<serde_json::Value, String> {
  bridge.list(cursor, archived.unwrap_or(false)).await
}
#[tauri::command]
async fn conversation_change(id: String, action: codex_conversations::ConversationAction, bridge: tauri::State<'_, codex_conversations::CodexConversations>) -> Result<(), String> {
  bridge.change(&id, action).await
}
#[tauri::command]
async fn conversation_create(bridge: tauri::State<'_, codex_conversations::CodexConversations>) -> Result<serde_json::Value, String> {
  bridge.create().await
}
#[tauri::command]
async fn conversation_read(id: String, cursor: Option<String>, bridge: tauri::State<'_, codex_conversations::CodexConversations>) -> Result<serde_json::Value, String> {
  bridge.read(&id, cursor).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationRequest { thread_id: String, message: String, context: String, request_id: String, execution_id: String, #[serde(flatten)] documents: conversation_documents::DocumentInputs }
#[tauri::command]
async fn conversation_run(request: ConversationRequest, bridge: tauri::State<'_, codex_conversations::CodexConversations>, executions: tauri::State<'_, task_execution::TaskExecutions>) -> Result<serde_json::Value, String> {
  bridge.run_with_documents(&request.thread_id, &request.message, &request.context, &request.request_id, &request.documents, executions.token(&request.execution_id)?).await
}
#[tauri::command]
fn library_capture_sources(id: String, ids: Vec<String>, state: tauri::State<'_, PlatformState>) -> Result<Vec<source_snapshots::SnapshotDocument>, String> {
  source_snapshots::capture(state.data_dir(), &id, &ids)
}
#[tauri::command]
fn library_read_snapshot(id: String, document_id: String, state: tauri::State<'_, PlatformState>) -> Result<source_snapshots::SnapshotDocument, String> {
  source_snapshots::source(state.data_dir(), &id, &document_id)
}
#[tauri::command]
fn conversation_publish(document: DocumentPublication, state: tauri::State<'_, PlatformState>) -> Result<(), String> {
  document_library::publish_document(state.data_dir(), "workbench.conversations", "Conversations", document).map(|_| ())
}

#[tauri::command]
fn library_grant_documents(capability_id: String, ids: Vec<String>, id: String, state: tauri::State<'_, PlatformState>) -> Result<document_grants::DocumentGrant, String> {
  state.grant_documents(&capability_id, ids, &id)
}
#[tauri::command]
fn capability_document_grants(capability_id: String, state: tauri::State<'_, PlatformState>) -> Result<Vec<document_grants::DocumentGrant>, String> {
  state.document_grants(&capability_id)
}
#[tauri::command]
fn capability_read_selected_document(capability_id: String, grant_id: String, document_id: String, state: tauri::State<'_, PlatformState>) -> Result<document_grants::SelectedDocument, String> {
  state.read_selected_document(&capability_id, &grant_id, &document_id)
}
#[tauri::command]
fn library_read_source(grant_id: String, document_id: String, state: tauri::State<'_, PlatformState>) -> Result<document_grants::SelectedDocument, String> {
  state.read_document_source(&grant_id, &document_id)
}
#[tauri::command]
fn library_search_content(query: String, state: tauri::State<'_, PlatformState>) -> Result<Vec<String>, String> {
  state.search_library_content(&query)
}

#[tauri::command]
fn library_list_documents(
  state: tauri::State<'_, PlatformState>,
) -> Result<Vec<LibraryDocumentMetadata>, String> {
  state.list_library_documents()
}

#[tauri::command]
fn library_read_document(
  id: String,
  state: tauri::State<'_, PlatformState>,
) -> Result<LibraryDocument, String> {
  state.read_library_document(&id)
}

#[tauri::command]
async fn test_selected_provider(
  language: String,
  state: tauri::State<'_, PlatformState>,
) -> Result<ModelResult, String> {
  let provider_kind = state.selected_provider()?;
  invoke_with_provider("Reply with exactly 'Provider ready'. Do not use tools.".into(), &provider_kind)
    .await
    .map_err(|detail| localize_provider_error(detail, is_english(&language)))
}

#[tauri::command]
async fn capability_ai_invoke(
  request: CapabilityAiRequest,
  executions: tauri::State<'_, task_execution::TaskExecutions>,
  state: tauri::State<'_, PlatformState>,
) -> Result<ModelResult, String> {
  let started = std::time::Instant::now();
  let capability_id = request.capability_id;
  let input_bytes = request.input.len();
  let provider_kind = match state.provider_for_capability(&capability_id) {
    Ok(provider_kind) => provider_kind,
    Err(detail) => {
      log::warn!(
        target: "workbench::capability",
        "ai.denied capability_id={capability_id} input_bytes={input_bytes}"
      );
      return Err(detail);
    }
  };
  log::info!(
    target: "workbench::capability",
    "ai.start capability_id={capability_id} provider_kind={provider_kind} input_bytes={input_bytes}"
  );
  let token = match request.execution_id {
    Some(id) => executions.token(&id)?,
    None => tokio_util::sync::CancellationToken::new(),
  };
  let result = tokio::select! {
    biased;
    _ = token.cancelled() => Err("Task cancelled".into()),
    result = invoke_with_provider(request.input, &provider_kind) => result,
  };
  match &result {
    Ok(output) => log::info!(
      target: "workbench::capability",
      "ai.complete capability_id={capability_id} provider_kind={provider_kind} output_bytes={} elapsed_ms={}",
      output.output.len(),
      started.elapsed().as_millis(),
    ),
    Err(_) => log::warn!(
      target: "workbench::capability",
      "ai.error capability_id={capability_id} provider_kind={provider_kind} elapsed_ms={}",
      started.elapsed().as_millis(),
    ),
  }
  result
}

#[tauri::command]
async fn capability_codex_sessions_read_daily_files(
  request: CapabilityCodexSessionsRequest,
  state: tauri::State<'_, PlatformState>,
) -> Result<CodexDailySessionFiles, String> {
  let started = std::time::Instant::now();
  if let Err(detail) = state.authorize_permission(
    &request.capability_id,
    capability_runtime::CapabilityPermission::CodexSessionsRead,
  ) {
    log::warn!(
      target: "workbench::codex_sessions",
      "scan.denied capability_id={}",
      request.capability_id,
    );
    return Err(detail);
  }
  let home = codex_home();
  let date = chrono::Local::now().format("%Y-%m-%d").to_string();
  let capability_id = request.capability_id;
  let scan_date = date.clone();
  log::info!(
    target: "workbench::codex_sessions",
    "scan.start capability_id={capability_id} date={scan_date}"
  );
  let result = tauri::async_runtime::spawn_blocking(move || read_daily_files(&home, &date))
    .await
    .map_err(|_| "读取 Codex sessions 的任务意外结束".to_string())?;
  match &result {
    Ok(files) => log::info!(
      target: "workbench::codex_sessions",
      "scan.complete capability_id={capability_id} date={scan_date} files={} bytes={} elapsed_ms={}",
      files.files.len(),
      files.files.iter().map(|file| file.content.len()).sum::<usize>(),
      started.elapsed().as_millis(),
    ),
    Err(_) => log::warn!(
      target: "workbench::codex_sessions",
      "scan.error capability_id={capability_id} date={scan_date} elapsed_ms={}",
      started.elapsed().as_millis(),
    ),
  }
  result
}

async fn invoke_with_provider(input: String, provider_kind: &str) -> Result<ModelResult, String> {
  if input.trim().is_empty() {
    return Err("AI input cannot be empty".into());
  }
  if input.len() > 100_000 {
    return Err("AI input is too large".into());
  }

  if provider_kind == "codex-api" {
    let provider = load_codex_api_profile(&codex_home())?;
    return invoke(provider, &input).await;
  }

  if provider_kind == "compatible-api" {
    return Err("兼容端点尚未接入，请选择 API key 托管或 Codex 订阅".into());
  }
  if provider_kind != "codex-subscription" {
    return Err("未知的 Provider 类型".into());
  }

  let codex_bin = codex_binary();
  let mut command = tokio::process::Command::from(codex_command(&codex_bin)
    .map_err(|_| "Could not prepare Codex executable path".to_string())?);
  command.kill_on_drop(true);
  command.arg("exec");
  let output = tokio::time::timeout(std::time::Duration::from_secs(600), command
    .args([
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
    ])
    .arg(input)
    .output()).await
    .map_err(|_| "Codex execution timed out".to_string())?
    .map_err(|_| "Unable to start codex exec".to_string())?;

  if !output.status.success() {
    return Err("codex exec returned a non-zero status".into());
  }

  let stdout = String::from_utf8(output.stdout)
    .map_err(|_| "codex exec returned invalid UTF-8".to_string())?;
  let output = extract_codex_output(&stdout)
    .ok_or_else(|| "Codex Agent 未返回文本结果".to_string())?;

  Ok(ModelResult {
    provider: "Codex 订阅".into(),
    model: "Codex CLI".into(),
    output,
  })
}

fn extract_codex_output(stdout: &str) -> Option<String> {
  stdout.lines().filter_map(|line| {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;
    let item = event.get("item")?;
    (event.get("type")?.as_str()? == "item.completed"
      && item.get("type")?.as_str()? == "agent_message")
      .then(|| item.get("text")?.as_str().map(str::to_string))
      .flatten()
  }).next_back()
}

#[tauri::command]
fn tasks_read(state: tauri::State<'_, PlatformState>) -> Result<Vec<serde_json::Value>, String> {
  state.read_tasks()
}

#[tauri::command]
fn tasks_write(records: Vec<serde_json::Value>, state: tauri::State<'_, PlatformState>) -> Result<(), String> {
  state.write_tasks(&records)
}

#[tauri::command]
fn task_cancel_invocation(id: String, executions: tauri::State<'_, task_execution::TaskExecutions>) -> Result<(), String> {
  executions.cancel(&id)
}

#[tauri::command]
fn capability_package_inspect(bytes: Vec<u8>) -> Result<package_installer::PackagePayload, String> {
  package_installer::inspect_archive(&bytes)
}

#[tauri::command]
fn capability_package_install(bytes: Vec<u8>, expected_version: Option<String>, state: tauri::State<'_, PlatformState>) -> Result<InstalledCapability, String> {
  state.activate_package(package_installer::inspect_archive(&bytes)?, expected_version, false)
}

#[tauri::command]
fn capability_package_read(id: String, previous: bool, state: tauri::State<'_, PlatformState>) -> Result<package_installer::PackagePayload, String> {
  state.package_payload(&id, previous)
}

#[tauri::command]
fn capability_package_rollback(id: String, expected_version: String, state: tauri::State<'_, PlatformState>) -> Result<InstalledCapability, String> {
  let package = state.package_payload(&id, true)?;
  state.activate_package(package, Some(expected_version), true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .filter(|metadata| metadata.target().starts_with("workbench::"))
          .max_file_size(MAX_LOG_FILE_SIZE)
          .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(LOG_FILES_TO_KEEP))
          .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
          .build(),
      )?;
      log::info!(
        target: "workbench::lifecycle",
        "app.start version={}",
        env!("CARGO_PKG_VERSION"),
      );
      let data_dir = app.path().app_data_dir()?;
      user_data::recover(&data_dir).map_err(std::io::Error::other)?;
      let event_app = app.handle().clone();
      app.manage(codex_conversations::CodexConversations::new(codex_binary(), data_dir.clone(), std::sync::Arc::new(move |event| { let _ = event_app.emit("workbench:codex-event", event); })));
      let platform_state = PlatformState::load(data_dir)
        .map_err(std::io::Error::other)?;
      app.manage(platform_state);
      app.manage(task_execution::TaskExecutions::default());
      app.manage(developer_integration::DeveloperIntegration::from_environment().map_err(std::io::Error::other)?);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      developer_integration::developer_integrations,
      developer_integration::developer_integration_install,
      developer_integration::developer_kit_export,
      conversation_list, conversation_change, conversation_create, conversation_read, conversation_run, conversation_publish,
      library_capture_sources, library_read_snapshot,
      library_management::library_organization, library_management::library_change,
      library_management::library_history, library_management::library_trash,
      user_data::user_data_export, user_data::user_data_restore, user_data::user_data_restored_id, user_data::library_export_markdown, user_data::conversation_export_document,
      tasks_read,
      tasks_write,
      task_cancel_invocation,
      capability_package_inspect,
      capability_package_install,
      capability_package_read,
      capability_package_rollback,
      provider_status,
      provider_health_check,
      get_selected_provider,
      set_selected_provider,
      install_capability,
      update_capability,
      list_capabilities,
      set_capability_enabled,
      uninstall_capability,
      test_selected_provider,
      capability_ai_invoke,
      capability_codex_sessions_read_daily_files,
      capability_documents_publish,
      library_grant_documents,
      capability_document_grants,
      capability_read_selected_document,
      library_read_source,
      library_search_content,
      library_list_documents,
      library_read_document,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(all(test, unix))]
mod subscription_tests {
  use super::*;
  use std::os::unix::fs::PermissionsExt;

  #[test]
  fn subscription_works_with_desktop_path() {
    let root = std::env::temp_dir().join(format!("nooki-subscription-path-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("config.toml"), "").unwrap();
    let cli = root.join("codex");
    let runtime = root.join("nooki-test-node");
    std::fs::write(&cli, "#!/usr/bin/env nooki-test-node\n").unwrap();
    std::fs::write(&runtime, r#"#!/bin/sh
case "$2 $3" in
  'login status') echo 'Logged in using ChatGPT' >&2 ;;
  'exec --ephemeral') echo '{"type":"item.completed","item":{"type":"agent_message","text":"Provider ready"}}' ;;
  *) exit 2 ;;
esac
"#).unwrap();
    for path in [&cli, &runtime] {
      std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    // A child test process isolates the Finder-like environment from other tests.
    let result = std::process::Command::new(std::env::current_exe().unwrap())
      .args(["--exact", "subscription_tests::subscription_probe", "--ignored", "--nocapture"])
      .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
      .env("CODEX_BIN", &cli)
      .env("CODEX_HOME", &root)
      .output().unwrap();
    std::fs::remove_dir_all(root).unwrap();
    assert!(result.status.success(), "{}\n{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
  }

  #[tokio::test]
  #[ignore = "runs in an isolated environment through subscription_works_with_desktop_path"]
  async fn subscription_probe() {
    let status = provider_status("codex-subscription".into(), "zh".into());
    assert_eq!(status.state, "ready", "{}", status.detail);
    let result = invoke_with_provider("Reply with Provider ready".into(), "codex-subscription").await.unwrap();
    assert_eq!(result.output, "Provider ready");
  }
}
