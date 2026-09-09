use crate::{capability_runtime::PlatformState, document_library, library_management::{self, DATA_LOCK}};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::{Cursor, Write}, path::{Component, Path}};
use tauri::Manager;

const ROOTS: &[&str] = &["document-library", "document-history", "library-organization.json", "source-snapshots", "document-grants", "codex-turn-receipts", "tasks.json"];
const LIMIT: usize = 128_000_000;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
  pub format: String, pub version: u32, pub created_at: String,
  pub files: BTreeMap<String, String>, pub local_storage: BTreeMap<String, String>,
  pub capabilities: serde_json::Value,
}
fn local_key(key: &str) -> bool {
  key.starts_with("personal-workbench:capability:") || key == "personal-workbench:activity-events" || key == "personal-workbench-preferences"
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
  if backup.format != "workbench-user-data" || backup.version != 1 { return Err("Unsupported Workbench backup".into()); }
  serde_json::from_value::<Vec<crate::capability_runtime::InstalledCapability>>(backup.capabilities.clone()).map_err(|_| "Invalid capability inventory")?;
  if backup.files.len() > 100_000 || backup.files.values().chain(backup.local_storage.values()).map(String::len).sum::<usize>() > LIMIT { return Err("Backup exceeds 128 MB".into()); }
  for (name, content) in &backup.files {
    if !safe_path(name) || !(name.ends_with(".json") || name.ends_with(".md")) { return Err("Invalid backup path".into()); }
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
  // Read every document before touching existing data, including legacy records.
  for doc in document_library::list_unlocked(&next)? {
    document_library::read_unlocked(&next, &doc.id)?;
    chrono::NaiveDate::parse_from_str(&doc.document_date, "%Y-%m-%d").map_err(|_| "Invalid document date")?;
    chrono::DateTime::parse_from_rfc3339(&doc.updated_at).map_err(|_| "Invalid document timestamp")?;
  }
  let organization = library_management::organization(&next)?;
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
  download(&app, &format!("Workbench-{}.workbench.json", chrono::Local::now().format("%Y%m%d-%H%M%S-%f")), &serde_json::to_vec(&backup).map_err(|e| e.to_string())?)
}
#[tauri::command]
pub fn user_data_restore(backup: Backup, transaction: String, state: tauri::State<'_, PlatformState>) -> Result<(), String> {
  if state.read_tasks()?.iter().any(|t| t["status"] == "running") { return Err("Stop running tasks before restoring".into()); }
  restore(state.data_dir(), &backup, &transaction)
}
#[tauri::command]
pub fn user_data_restored_id(state: tauri::State<'_, PlatformState>) -> Result<Option<String>, String> { restored_id(state.data_dir()) }
#[tauri::command]
pub fn library_export_markdown(app: tauri::AppHandle, ids: Vec<String>, state: tauri::State<'_, PlatformState>) -> Result<String, String> {
  let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
  let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
  let unique: std::collections::BTreeSet<_> = ids.into_iter().collect();
  if unique.is_empty() { return Err("Select documents to export".into()); }
  let mut total = 0;
  for id in unique {
    let doc = document_library::read_document(state.data_dir(), &id)?;
    total += doc.content.len(); if total > LIMIT { return Err("Export exceeds 128 MB".into()); }
    zip.start_file(format!("{id}.md"), options).map_err(|e| e.to_string())?;
    zip.write_all(doc.content.as_bytes()).map_err(|e| e.to_string())?;
  }
  zip.start_file("README.txt", options).map_err(|e| e.to_string())?;
  zip.write_all("文档按来源保留为 Markdown。内部引用请在 Workbench 中打开；迁移资料和引用快照请使用完整数据备份。\nDocuments are organized by source. Internal citations open in Workbench; use a data backup to retain snapshots.\n".as_bytes()).map_err(|e| e.to_string())?;
  let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
  download(&app, &format!("Workbench-documents-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S-%f")), &bytes)
}
