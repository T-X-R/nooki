pub mod codex_conversations;
pub mod conversation_documents;
pub mod conversation_host;
pub mod source_snapshots;
pub mod document_grants;
pub mod capability_runtime;
pub mod codex_session_source;
pub mod agent_tools;
pub mod document_library;
pub mod library_management;
pub mod native_agent_sessions;
pub mod user_data;
pub mod package_installer;
pub mod task_execution;
pub mod developer_integration;
pub mod skill_pool;

use capability_runtime::{CapabilityManifest, InstalledCapability, PlatformState};
use codex_session_source::{read_daily_files, CodexDailySessionFiles};
use document_library::{DocumentPublication, LibraryDocument, LibraryDocumentMetadata};
use serde::Deserialize;
use tauri::{Emitter, Manager};

const MAX_LOG_FILE_SIZE: u128 = 2_000_000;
const LOG_FILES_TO_KEEP: usize = 3;

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
  agent_tools::with_launcher_path(binary)
}

fn is_english(language: &str) -> bool {
  language == "en"
}

#[tauri::command]
fn agent_tools(pool: tauri::State<'_, skill_pool::SkillPool>) -> Vec<agent_tools::AgentToolView> {
  pool.agents().overview(pool.directory(), &pool.custom_tools())
}

/// A choice a person made is honoured even while it is broken, so Settings can show them why. A
/// default nobody chose gives way to an agent that is actually on this machine.
fn resolved_agent(state: &PlatformState, pool: &skill_pool::SkillPool) -> Result<String, String> {
  let chosen = state.capability_agent()?;
  if chosen != capability_runtime::DEFAULT_AGENT {
    return Ok(chosen);
  }
  let serves = pool
    .agents()
    .overview(pool.directory(), &[])
    .into_iter()
    .any(|tool| tool.id == chosen && tool.serves_capabilities);
  if serves {
    return Ok(chosen);
  }
  Ok(pool.agents().default_agent(pool.directory()).unwrap_or(chosen))
}

#[tauri::command]
fn capability_agent(
  state: tauri::State<'_, PlatformState>,
  pool: tauri::State<'_, skill_pool::SkillPool>,
) -> Result<String, String> {
  resolved_agent(&state, &pool)
}

#[tauri::command]
fn set_capability_agent(
  agent: String,
  state: tauri::State<'_, PlatformState>,
) -> Result<(), String> {
  state.set_capability_agent(&agent)
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
async fn conversation_list(cursor: Option<String>, archived: Option<bool>, bridge: tauri::State<'_, conversation_host::ConversationHost>) -> Result<serde_json::Value, String> {
  bridge.list(cursor, archived.unwrap_or(false)).await
}
#[tauri::command]
async fn conversation_change(id: String, action: codex_conversations::ConversationAction, bridge: tauri::State<'_, conversation_host::ConversationHost>) -> Result<(), String> {
  bridge.change(&id, action).await
}
#[tauri::command]
async fn conversation_create(state: tauri::State<'_, PlatformState>, pool: tauri::State<'_, skill_pool::SkillPool>, bridge: tauri::State<'_, conversation_host::ConversationHost>) -> Result<serde_json::Value, String> {
  bridge.create(&resolved_agent(&state, &pool)?).await
}
#[tauri::command]
async fn conversation_read(id: String, cursor: Option<String>, bridge: tauri::State<'_, conversation_host::ConversationHost>) -> Result<serde_json::Value, String> {
  bridge.read(&id, cursor).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationRequest { thread_id: String, message: String, context: String, request_id: String, execution_id: String, #[serde(flatten)] documents: conversation_documents::DocumentInputs }
#[tauri::command]
async fn conversation_run(request: ConversationRequest, bridge: tauri::State<'_, conversation_host::ConversationHost>, pool: tauri::State<'_, skill_pool::SkillPool>, executions: tauri::State<'_, task_execution::TaskExecutions>) -> Result<serde_json::Value, String> {
  bridge.run(&conversation_host::ConversationRequest { thread_id: request.thread_id, message: request.message, context: request.context, request_id: request.request_id, documents: request.documents }, pool.agents(), executions.token(&request.execution_id)?).await
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

/// The only honest health check is the thing a Capability actually does.
#[tauri::command]
async fn capability_agent_test(
  language: String,
  state: tauri::State<'_, PlatformState>,
  pool: tauri::State<'_, skill_pool::SkillPool>,
) -> Result<agent_tools::ModelResult, String> {
  let agent = resolved_agent(&state, &pool)?;
  pool
    .agents()
    .invoke(&agent, pool.directory(), "Reply with exactly 'Ready'. Do not use tools.")
    .await
    .map_err(|error| error.say(is_english(&language)))
}

/// Guards that belong to Nooki, not to the agent: a Capability may not send nothing, and may not
/// send more than a person could have meant to.
async fn invoke_capability_agent(
  pool: &skill_pool::SkillPool,
  agent: &str,
  input: String,
  language: String,
) -> Result<agent_tools::ModelResult, String> {
  let english = is_english(&language);
  if input.trim().is_empty() {
    return Err(if english { "The request is empty".into() } else { "请求内容为空".to_string() });
  }
  if input.len() > 100_000 {
    return Err(if english { "The request is too large".into() } else { "请求内容过长".to_string() });
  }
  pool.agents().invoke(agent, pool.directory(), &input).await.map_err(|error| error.say(english))
}

#[tauri::command]
async fn capability_ai_invoke(
  request: CapabilityAiRequest,
  executions: tauri::State<'_, task_execution::TaskExecutions>,
  state: tauri::State<'_, PlatformState>,
  pool: tauri::State<'_, skill_pool::SkillPool>,
  language: String,
) -> Result<agent_tools::ModelResult, String> {
  let started = std::time::Instant::now();
  let capability_id = request.capability_id;
  let input_bytes = request.input.len();
  let agent = match state.agent_for_capability(&capability_id).and_then(|_| resolved_agent(&state, &pool)) {
    Ok(agent) => agent,
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
    "ai.start capability_id={capability_id} agent={agent} input_bytes={input_bytes}"
  );
  let token = match request.execution_id {
    Some(id) => executions.token(&id)?,
    None => tokio_util::sync::CancellationToken::new(),
  };
  let result = tokio::select! {
    biased;
    _ = token.cancelled() => Err("Task cancelled".into()),
    result = invoke_capability_agent(&pool, &agent, request.input, language.clone()) => result,
  };
  match &result {
    Ok(output) => log::info!(
      target: "workbench::capability",
      "ai.complete capability_id={capability_id} agent={agent} output_bytes={} elapsed_ms={}",
      output.output.len(),
      started.elapsed().as_millis(),
    ),
    Err(_) => log::warn!(
      target: "workbench::capability",
      "ai.error capability_id={capability_id} agent={agent} elapsed_ms={}",
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
      app.manage(conversation_host::ConversationHost::new(codex_binary(), data_dir.clone(), std::sync::Arc::new(move |event| { let _ = event_app.emit("workbench:conversation-event", event); })));
      let platform_state = PlatformState::load(data_dir)
        .map_err(std::io::Error::other)?;
      app.manage(platform_state);
      app.manage(task_execution::TaskExecutions::default());
      app.manage(developer_integration::DeveloperIntegration::from_environment().map_err(std::io::Error::other)?);
      app.manage(skill_pool::SkillPool::from_environment(app.path().app_data_dir()?).map_err(std::io::Error::other)?);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      developer_integration::developer_integration,
      developer_integration::developer_integration_install,
      developer_integration::developer_kit_export,
      skill_pool::skill_pool_overview,
      skill_pool::skill_pool_set_selection,
      skill_pool::skill_pool_resolve,
      skill_pool::skill_pool_read,
      skill_pool::skill_pool_read_file,
      skill_pool::skill_pool_delete,
      skill_pool::skill_pool_add_tool,
      skill_pool::skill_pool_remove_tool,
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
      agent_tools,
      capability_agent,
      set_capability_agent,
      install_capability,
      update_capability,
      list_capabilities,
      set_capability_enabled,
      uninstall_capability,
      capability_agent_test,
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
