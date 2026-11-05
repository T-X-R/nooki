use crate::{capability_runtime::PlatformState, document_library, library_management::{self, DATA_LOCK}};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::{Component, Path}};
use tauri::Manager;

const ROOTS: &[&str] = &["document-library", "document-history", "library-organization.json", "source-snapshots", "document-grants", "codex-turn-receipts", "conversation-document-state", "conversation-workspaces", "conversation-agents.json", "capability-tool-threads.json", "agent-sessions", "tasks.json", "task-board.json"];
const LIMIT: usize = 128_000_000;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
  pub format: String, pub version: u32, pub created_at: String,
  pub files: BTreeMap<String, String>, pub local_storage: BTreeMap<String, String>,
  pub capabilities: serde_json::Value,
}
fn local_key(key: &str) -> bool {
  key.starts_with("personal-workbench:capability:") || key == "personal-workbench:activity-events" || key == "personal-workbench-preferences" || key == "personal-workbench-library-drafts-v1"
}
fn safe_path(name: &str) -> bool {
  !name.contains('\\') && !name.contains('\0') && Path::new(name).components().all(|part| matches!(part, Component::Normal(_)))
    && ROOTS.contains(&name.split('/').next().unwrap_or(""))
    && (if name.split('/').next().unwrap_or("").ends_with(".json") { !name.contains('/') } else { name.contains('/') })
}
fn collect(root: &Path, path: &Path, files: &mut BTreeMap<String, String>) -> Result<(), String> {
  if !path.try_exists().map_err(|e| e.to_string())? { return Ok(()); }
  if fs::symlink_metadata(path).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("Linked data cannot be backed up or restored".into()); }
  if path.is_dir() {
    for item in fs::read_dir(path).map_err(|e| e.to_string())? { collect(root, &item.map_err(|e| e.to_string())?.path(), files)?; }
  } else {
    let name = path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    if name.starts_with("conversation-workspaces/") && (name.split('/').count() != 3 || !["md", "txt"].iter().any(|ext| name.to_ascii_lowercase().ends_with(&format!(".{ext}")))) { return Ok(()); }
    if name.starts_with("agent-sessions/") && (name.split('/').count() != 2 || !name.to_ascii_lowercase().ends_with(".jsonl")) { return Ok(()); }
    if name.ends_with(".pending") || name.ends_with(".tmp") { return Ok(()); }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.len() + files.values().map(String::len).sum::<usize>() > LIMIT { return Err("Backup exceeds 128 MB".into()); }
    files.insert(name, content);
  }
  Ok(())
}
pub fn capture(root: &Path, local_storage: BTreeMap<String, String>, capabilities: serde_json::Value) -> Result<Backup, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Data unavailable")?;
  let mut files = BTreeMap::new();
  for name in ROOTS { collect(root, &root.join(name), &mut files)?; }
  let backup = Backup { format: "workbench-user-data".into(), version: 1, created_at: chrono::Local::now().to_rfc3339(), files, local_storage, capabilities };
  validate(&backup)?;
  Ok(backup)
}
pub fn validate(backup: &Backup) -> Result<(), String> {
  if backup.format != "workbench-user-data" || backup.version != 1 { return Err("Unsupported Nooki backup".into()); }
  serde_json::from_value::<Vec<crate::capability_runtime::InstalledCapability>>(backup.capabilities.clone()).map_err(|_| "Invalid capability inventory")?;
  if backup.files.len() > 100_000 || backup.files.values().chain(backup.local_storage.values()).map(String::len).sum::<usize>() > LIMIT { return Err("Backup exceeds 128 MB".into()); }
  for (name, content) in &backup.files {
    if !safe_path(name) || !(name.ends_with(".json") || name.ends_with(".md") || (name.starts_with("conversation-workspaces/") && (name.to_ascii_lowercase().ends_with(".txt") || name.to_ascii_lowercase().ends_with(".md"))) || (name.starts_with("agent-sessions/") && name.to_ascii_lowercase().ends_with(".jsonl"))) { return Err("Invalid backup path".into()); }
    if name.ends_with(".json") { serde_json::from_str::<serde_json::Value>(content).map_err(|_| format!("Invalid JSON in {name}"))?; }
    if name.starts_with("document-history/") {
      let doc: document_library::LibraryDocument = serde_json::from_str(content).map_err(|_| "Invalid document history")?;
      document_library::validate_id(&doc.id)?;
      if name != &format!("document-history/{}/{}.json", doc.id, document_library::revision(&doc)) { return Err("Invalid history identity".into()); }
    }
    if name.starts_with("source-snapshots/") {
      let docs: Vec<crate::source_snapshots::SnapshotDocument> = serde_json::from_str(content).map_err(|_| "Invalid source snapshot")?;
      for doc in docs { document_library::validate_id(doc.reference["documentId"].as_str().ok_or("Invalid snapshot reference")?)?; }
    }
    if name.starts_with("document-grants/") { serde_json::from_str::<crate::document_grants::DocumentGrant>(content).map_err(|_| "Invalid document grant")?; }
    if name.starts_with("codex-turn-receipts/") {
      let receipt: serde_json::Value = serde_json::from_str(content).map_err(|_| "Invalid turn receipt")?;
      if !receipt["threadId"].is_string() || !receipt["turnId"].is_string() { return Err("Invalid turn receipt".into()); }
    }
  }
  for (key, value) in &backup.local_storage {
    if !local_key(key) { return Err("Invalid backup storage key".into()); }
    let parsed: serde_json::Value = serde_json::from_str(value).map_err(|_| "Invalid local data")?;
    if key == "personal-workbench:activity-events" {
      let events = parsed.as_array().ok_or("Invalid activity history")?;
      if events.iter().any(|event| ["id", "type", "title", "source", "occurredAt"].iter().any(|field| !event[field].is_string())) { return Err("Invalid activity record".into()); }
    }
    if key == "personal-workbench-preferences" && !parsed["state"].is_object() { return Err("Invalid interface preferences".into()); }
  }
  if let Some(board) = backup.files.get("task-board.json") {
    let board: serde_json::Value = serde_json::from_str(board).map_err(|_| "Invalid task board")?;
    validate_task_board(&board)?;
  }
  if let Some(tasks) = backup.files.get("tasks.json") {
    let parsed: serde_json::Value = serde_json::from_str(tasks).map_err(|e| e.to_string())?;
    let tasks = parsed.as_array().ok_or("Invalid task history")?;
    for task in tasks {
      if ["id", "capabilityId", "capabilityVersion", "job", "createdAt", "updatedAt"].iter().any(|field| !task[field].is_string())
        || !task["checkpoints"].is_object() || !task["attempt"].is_u64()
        || !["running", "completed", "failed", "cancelled", "interrupted"].contains(&task["status"].as_str().unwrap_or("")) { return Err("Invalid task record".into()); }
    }
  }
  Ok(())
}
pub(crate) fn validate_task_board(board: &serde_json::Value) -> Result<(), String> {
  let cards = board["cards"].as_array().ok_or("Invalid task board")?;
  let mut ids = std::collections::HashSet::new();
  if let Some(paused) = board.get("paused") {
    if !paused.is_boolean() { return Err("Invalid task board pause state".into()); }
  }
  for card in cards {
    let id = card["id"].as_str().filter(|id| !id.is_empty()).ok_or("Invalid task card ID")?;
    let title = card["title"].as_str().filter(|title| !title.trim().is_empty() && title.chars().count() <= 120);
    let description = card["description"].as_str().filter(|text| text.chars().count() <= 20_000);
    let status = card["status"].as_str().unwrap_or("");
    if !ids.insert(id) || title.is_none() || description.is_none()
      || !["todo", "queued", "running", "question", "review", "stopped", "done"].contains(&status) {
      return Err("Invalid task card".into());
    }
    for field in ["threadId", "runId", "followUp", "error"] {
      if card.get(field).is_some_and(|value| !value.is_string()) { return Err("Invalid task card metadata".into()); }
    }
    if card.get("queuedAt").is_some_and(|value| !value.is_u64()) { return Err("Invalid task queue position".into()); }
    if let Some(delivery) = card.get("delivery") {
      let artifacts = delivery["artifacts"].as_array().ok_or("Invalid task delivery")?;
      if !delivery["text"].is_string() || delivery.get("question").is_some_and(|value| !value.is_boolean())
        || artifacts.iter().any(|artifact| ["id", "name", "content"].iter().any(|key| !artifact[key].is_string())) {
        return Err("Invalid task delivery".into());
      }
    }
    if let Some(auth) = card.get("authorization") {
      let snapshot = auth["snapshotId"].as_str().filter(|id| !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'));
      let docs = auth["documentIds"].as_array().filter(|docs| docs.len() <= 50).ok_or("Invalid task sources")?;
      if snapshot.is_none() { return Err("Invalid task snapshot".into()); }
      for doc in docs { document_library::validate_id(doc.as_str().ok_or("Invalid task source")?)?; }
    } else if !matches!(status, "todo" | "done") { return Err("Task delegation is missing".into()); }
  }
  Ok(())
}
fn remove(path: &Path) -> Result<(), String> {
  if !path.exists() { return Ok(()); }
  if fs::symlink_metadata(path).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("Linked data cannot be replaced".into()); }
  if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) }.map_err(|e| e.to_string())
}
fn write_files(root: &Path, files: &BTreeMap<String, String>) -> Result<(), String> {
  for (name, content) in files {
    let path = root.join(name);
    fs::create_dir_all(path.parent().ok_or("Invalid path")?).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
  }
  Ok(())
}
// A durable rollback copy makes an interrupted multi-directory replacement recoverable at startup.
pub fn recover(root: &Path) -> Result<(), String> {
  let directory = root.join(".data-restore");
  let marker = directory.join("prepared.json");
  if marker.exists() {
    let id: String = serde_json::from_slice(&fs::read(&marker).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if restored_id(root)? != Some(id) {
      let mut previous = BTreeMap::new();
      collect(&directory.join("previous"), &directory.join("previous"), &mut previous)?;
      for name in ROOTS { remove(&root.join(name))?; }
      write_files(root, &previous)?;
    }
  }
  remove(&directory)
}
pub fn restored_id(root: &Path) -> Result<Option<String>, String> {
  let path = root.join("data-restore-committed.json");
  if !path.exists() { return Ok(None); }
  serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map(Some).map_err(|e| e.to_string())
}
pub fn restore(root: &Path, backup: &Backup, transaction: &str) -> Result<(), String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Data unavailable")?;
  validate(backup)?;
  if transaction.is_empty() || transaction.len() > 100 || !transaction.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return Err("Invalid restore transaction".into()); }
  recover(root)?;
  let directory = root.join(".data-restore");
  let next = directory.join("next");
  write_files(&next, &backup.files)?;
  if let Some(board) = backup.files.get("task-board.json") {
    let mut board: serde_json::Value = serde_json::from_str(board).map_err(|_| "Invalid task board")?;
    // Importing an archive does not authorize new agent execution on this machine.
    board["paused"] = serde_json::Value::Bool(true);
    library_management::write_json(&next.join("task-board.json"), &board)?;
  }
  // Read every document before touching existing data, including legacy records.
  for doc in document_library::list_unlocked(&next)? {
    document_library::read_unlocked(&next, &doc.id)?;
    chrono::NaiveDate::parse_from_str(&doc.document_date, "%Y-%m-%d").map_err(|_| "Invalid document date")?;
    chrono::DateTime::parse_from_rfc3339(&doc.updated_at).map_err(|_| "Invalid document timestamp")?;
  }
  let organization = library_management::organization(&next)?;
  if let Some(folders) = &organization.folders {
    let mut seen = std::collections::BTreeSet::new();
    for folder in folders {
      if !seen.insert(&folder.id) { return Err("Duplicate folder identity".into()); }
      crate::library_folders::validate(folders, folder)?;
      for id in &folder.document_ids { document_library::read_unlocked(&next, id)?; }
    }
  }
  for topic in organization.topics { for id in topic.document_ids { document_library::read_unlocked(&next, &id)?; } }
  let mut previous = BTreeMap::new();
  for name in ROOTS { collect(root, &root.join(name), &mut previous)?; }
  write_files(&directory.join("previous"), &previous)?;
  library_management::write_json(&directory.join("prepared.json"), &transaction)?;
  let result = (|| {
    for name in ROOTS {
      remove(&root.join(name))?;
      if next.join(name).exists() { fs::rename(next.join(name), root.join(name)).map_err(|e| e.to_string())?; }
    }
    library_management::write_json(&root.join("data-restore-committed.json"), &transaction)
  })();
  if let Err(error) = result { recover(root)?; return Err(error); }
  // A leftover committed staging directory is harmless and cleaned on the next launch.
  let _ = remove(&directory);
  Ok(())
}
fn download(app: &tauri::AppHandle, name: &str, bytes: &[u8]) -> Result<String, String> {
  let directory = app.path().download_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
  let path = directory.join(name);
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
  file.write_all(bytes).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn user_data_export(app: tauri::AppHandle, local_storage: BTreeMap<String, String>, state: tauri::State<'_, PlatformState>) -> Result<String, String> {
  let backup = capture(state.data_dir(), local_storage, serde_json::to_value(state.list_capabilities()?).map_err(|e| e.to_string())?)?;
  download(&app, &format!("Nooki-{}.workbench.json", chrono::Local::now().format("%Y%m%d-%H%M%S-%f")), &serde_json::to_vec(&backup).map_err(|e| e.to_string())?)
}
#[tauri::command]
pub fn user_data_restore(backup: Backup, transaction: String, state: tauri::State<'_, PlatformState>) -> Result<(), String> {
  if state.read_tasks()?.iter().any(|t| t["status"] == "running") { return Err("Stop running tasks before restoring".into()); }
  restore(state.data_dir(), &backup, &transaction)
}
#[tauri::command]
pub fn user_data_restored_id(state: tauri::State<'_, PlatformState>) -> Result<Option<String>, String> { restored_id(state.data_dir()) }
#[tauri::command]
pub async fn library_export_markdown(window: tauri::WebviewWindow, id: String, state: tauri::State<'_, PlatformState>) -> Result<bool, String> {
  let doc = document_library::read_document(state.data_dir(), &id)?;
  let name: String = doc.title.chars().filter(|c| !c.is_control() && *c != '/' && *c != '\\' && *c != ':').take(120).collect();
  let name = if name.trim_matches('.').trim().is_empty() { "Untitled".into() } else { name };
  let name = if name.to_ascii_lowercase().ends_with(".md") { name } else { format!("{name}.md") };
  let (sender, receiver) = tokio::sync::oneshot::channel();
  // AppKit dialog construction must run on the UI thread, including rfd's future setup.
  window.app_handle().clone().run_on_main_thread(move || {
    let dialog = rfd::AsyncFileDialog::new().set_parent(&window).set_file_name(name)
      .set_can_create_directories(true).add_filter("Markdown", &["md"]).save_file();
    tauri::async_runtime::spawn(async move { let _ = sender.send(dialog.await); });
  }).map_err(|error| error.to_string())?;
  let Some(file) = receiver.await.map_err(|error| error.to_string())? else { return Ok(false); };
  file.write(doc.content.as_bytes()).await.map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
pub fn conversation_export_document(app: tauri::AppHandle, name: String, content: String) -> Result<String, String> {
  if content.len() > 2_000_000 { return Err("Document exceeds 2 MB".into()); }
  let name: String = name.chars().filter(|c| !c.is_control() && *c != '/' && *c != '\\').take(120).collect();
  let name = if name.to_ascii_lowercase().ends_with(".md") || name.to_ascii_lowercase().ends_with(".txt") { name } else { format!("{name}.md") };
  download(&app, &format!("Nooki-{}-{name}", chrono::Local::now().format("%Y%m%d-%H%M%S-%f")), content.as_bytes())
}
