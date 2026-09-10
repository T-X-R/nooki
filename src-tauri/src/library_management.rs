use crate::document_library::{self, DocumentPublication, LibraryDocument, LibraryDocumentMetadata};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path, sync::Mutex};

pub static DATA_LOCK: Mutex<()> = Mutex::new(());
const STATE_FILE: &str = "library-organization.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
  pub topics: Vec<Topic>,
  pub trash: BTreeMap<String, String>,
  pub origins: BTreeMap<String, Origin>,
  #[serde(default)]
  pub sections: BTreeMap<String, LibrarySection>,
  #[serde(default)]
  pub custom_sections: Vec<LibrarySection>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic { pub id: String, pub name: String, pub document_ids: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin { pub thread_id: String, pub message_id: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibrarySection { pub id: String, pub name: String }
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LibraryChange {
  Import { document: DocumentPublication },
  Edit { id: String, title: String, content: String, expected: String },
  RestoreVersion { id: String, revision: String, expected: String },
  SaveTopic { topic: Topic },
  DeleteTopic { id: String },
  CreateSection { section: LibrarySection },
  Trash { ids: Vec<String> },
  Restore { ids: Vec<String> },
  Purge { ids: Vec<String> },
  Place { id: String, #[serde(rename = "topicId")] topic_id: Option<String>, section: LibrarySection },
  Origin { id: String, origin: Origin },
}

pub fn organization(root: &Path) -> Result<Organization, String> {
  let path = root.join(STATE_FILE);
  if !path.exists() { return Ok(Organization::default()); }
  serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn save_organization(root: &Path, state: &Organization) -> Result<(), String> {
  write_json(&root.join(STATE_FILE), state)
}
pub(crate) fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
  fs::create_dir_all(path.parent().ok_or("Invalid data path")?).map_err(|e| e.to_string())?;
  let pending = path.with_extension("pending");
  fs::write(&pending, serde_json::to_vec(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  fs::rename(pending, path).map_err(|e| e.to_string())
}
pub(crate) fn retain(root: &Path, doc: &LibraryDocument) -> Result<(), String> {
  let revision = document_library::revision(doc);
  let path = root.join("document-history").join(&doc.id).join(format!("{revision}.json"));
  if !path.exists() { write_json(&path, doc)?; }
  Ok(())
}
pub fn history(root: &Path, id: &str) -> Result<Vec<LibraryDocument>, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let current = document_library::read_unlocked(root, id)?;
  let mut versions = vec![current.clone()];
  let directory = root.join("document-history").join(id);
  if directory.exists() {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
      let path = entry.map_err(|e| e.to_string())?.path();
      if path.extension().and_then(|v| v.to_str()) != Some("json") { continue; }
      let doc: LibraryDocument = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
      if doc.id != id { return Err("Invalid version identity".into()); }
      if document_library::revision(&doc) != document_library::revision(&current) { versions.push(doc); }
    }
  }
  // The authoritative current version stays first even after a clock/timezone change.
  versions[1..].sort_by(|a, b| chrono::DateTime::parse_from_rfc3339(&b.updated_at).ok().cmp(&chrono::DateTime::parse_from_rfc3339(&a.updated_at).ok()));
  for doc in &mut versions { doc.metadata.revision = Some(document_library::revision(doc)); }
  Ok(versions)
}
fn edit(root: &Path, id: &str, title: String, content: String, expected: &str) -> Result<LibraryDocumentMetadata, String> {
  let doc = document_library::read_unlocked(root, id)?;
  if document_library::revision(&doc) != expected { return Err("文档已更新，请重新打开后修改 / Document changed. Reopen it before editing.".into()); }
  document_library::publish_unlocked(root, &doc.capability_id, &doc.capability_name, DocumentPublication {
    key: doc.key.clone(), title, collection_key: doc.collection_key.clone(), collection_name: doc.collection_name.clone(),
    document_date: doc.document_date.clone(), content,
  })
}
pub fn change(root: &Path, change: LibraryChange) -> Result<Option<LibraryDocumentMetadata>, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let mut state = organization(root)?;
  match change {
    LibraryChange::Import { mut document } => {
      document.collection_key = "imports".into();
      document.collection_name = "导入资料 / Imported documents".into();
      let metadata = document_library::publish_unlocked(root, "workbench.imports", "导入 / Imports", document)?;
      return Ok(Some(metadata));
    }
    LibraryChange::Edit { id, title, content, expected } => return edit(root, &id, title, content, &expected).map(Some),
    LibraryChange::RestoreVersion { id, revision, expected } => {
      document_library::read_unlocked(root, &id)?;
      if revision.len() != 64 || !revision.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("Invalid revision".into()); }
      let source = fs::read(root.join("document-history").join(&id).join(format!("{revision}.json"))).map_err(|_| "Version not found")?;
      let doc: LibraryDocument = serde_json::from_slice(&source).map_err(|_| "Invalid version")?;
      if doc.id != id || document_library::revision(&doc) != revision { return Err("Invalid version identity".into()); }
      return edit(root, &id, doc.title.clone(), doc.content, &expected).map(Some);
    }
    LibraryChange::SaveTopic { mut topic } => {
      if topic.id.is_empty() || topic.id.len() > 100 || !topic.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') || topic.name.trim().is_empty() || topic.name.chars().count() > 80 { return Err("Invalid topic".into()); }
      topic.name = topic.name.trim().into();
      topic.document_ids.sort(); topic.document_ids.dedup();
      for id in &topic.document_ids { document_library::read_unlocked(root, id)?; }
      if let Some(existing) = state.topics.iter_mut().find(|t| t.id == topic.id) { *existing = topic; } else { state.topics.push(topic); }
    }
    LibraryChange::CreateSection { mut section } => {
      section.name = section.name.trim().into();
      if !section.id.starts_with("custom-") || section.id.len() <= 7 || section.id.len() > 107 || !section.id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') || section.name.is_empty() || section.name.chars().count() > 80 { return Err("栏目名称无效 / Invalid section name".into()); }
      if state.custom_sections.iter().any(|s| s.id == section.id || s.name.to_lowercase() == section.name.to_lowercase()) { return Err("栏目已存在 / Section already exists".into()); }
      state.custom_sections.push(section);
    }
    LibraryChange::DeleteTopic { id } => state.topics.retain(|t| t.id != id),
    LibraryChange::Trash { ids } => {
      for id in &ids { document_library::read_unlocked(root, id)?; }
      for id in ids { state.trash.insert(id, chrono::Local::now().to_rfc3339()); }
    }
    LibraryChange::Restore { ids } => { for id in ids { state.trash.remove(&id); } }
    LibraryChange::Purge { ids } => {
      // Retained citation snapshots are independent evidence and are never removed here.
      for id in &ids {
        if !state.trash.contains_key(id) { return Err("Only documents in Trash can be deleted permanently".into()); }
        document_library::validate_id(id)?;
      }
      for id in ids {
        for extension in ["md", "json"] {
          let path = root.join("document-library").join(&id).with_extension(extension);
          if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
        }
        let history = root.join("document-history").join(&id);
        if history.exists() { fs::remove_dir_all(history).map_err(|e| e.to_string())?; }
        state.trash.remove(&id); state.origins.remove(&id); state.sections.remove(&id);
        for topic in &mut state.topics { topic.document_ids.retain(|value| value != &id); }
      }
    }
    LibraryChange::Place { id, topic_id, mut section } => {
      document_library::read_unlocked(root, &id)?;
      if state.trash.contains_key(&id) { return Err("文档在回收站中 / Document is in Trash".into()); }
      if section.id.trim().is_empty() || section.id.len() > 200 || section.name.trim().is_empty() || section.name.chars().count() > 80 { return Err("栏目无效 / Invalid section".into()); }
      if let Some(topic_id) = topic_id.filter(|id| !id.is_empty()) {
        let topic = state.topics.iter_mut().find(|topic| topic.id == topic_id).ok_or("专题已不存在，请重新选择 / Topic no longer exists")?;
        if !topic.document_ids.contains(&id) { topic.document_ids.push(id.clone()); }
      }
      section.name = section.name.trim().into();
      state.sections.insert(id, section);
    }
    LibraryChange::Origin { id, origin } => { document_library::read_unlocked(root, &id)?; state.origins.insert(id, origin); }
  }
  save_organization(root, &state)?;
  Ok(None)
}

#[tauri::command]
pub fn library_organization(state: tauri::State<'_, crate::capability_runtime::PlatformState>) -> Result<Organization, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  organization(state.data_dir())
}
#[tauri::command]
pub fn library_change(change: LibraryChange, state: tauri::State<'_, crate::capability_runtime::PlatformState>) -> Result<Option<LibraryDocumentMetadata>, String> { self::change(state.data_dir(), change) }
#[tauri::command]
pub fn library_history(id: String, state: tauri::State<'_, crate::capability_runtime::PlatformState>) -> Result<Vec<LibraryDocument>, String> { history(state.data_dir(), &id) }
#[tauri::command]
pub fn library_trash(state: tauri::State<'_, crate::capability_runtime::PlatformState>) -> Result<Vec<LibraryDocumentMetadata>, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let state_info = organization(state.data_dir())?;
  Ok(document_library::list_unlocked(state.data_dir())?.into_iter().filter(|d| state_info.trash.contains_key(&d.id)).collect())
}
