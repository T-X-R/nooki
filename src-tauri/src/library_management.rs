use crate::library_folders;
use crate::document_library::{self, DocumentPublication, LibraryDocument, LibraryDocumentMetadata};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet}, fs, path::Path, sync::Mutex};

pub static DATA_LOCK: Mutex<()> = Mutex::new(());
const STATE_FILE: &str = "library-organization.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
  #[serde(default)]
  pub folders: Option<Vec<LibraryFolder>>,
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
pub struct LibraryFolder { pub id: String, pub name: String, #[serde(default, skip_serializing_if = "Option::is_none")] pub parent_id: Option<String>, #[serde(default)] pub document_ids: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic { pub id: String, pub name: String, pub document_ids: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin { pub thread_id: String, pub message_id: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySection {
  pub id: String, pub name: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub topic_id: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LibraryChange {
  Import { document: DocumentPublication, #[serde(rename = "folderId")] folder_id: Option<String> },
  SaveFolder { folder: LibraryFolder },
  DeleteFolder { id: String },
  MoveDocuments { ids: Vec<String>, #[serde(rename = "folderId")] folder_id: Option<String> },
  Create { document: DocumentPublication, #[serde(rename = "folderId")] folder_id: Option<String>, #[serde(rename = "topicId")] topic_id: Option<String>, section: Option<LibrarySection> },
  Edit { id: String, title: String, content: String, expected: String },
  RestoreVersion { id: String, revision: String, expected: String },
  SaveTopic { topic: Topic },
  DeleteTopic { id: String },
  CreateSection { section: LibrarySection },
  RenameSection { id: String, name: String },
  DeleteSection { id: String },
  DeleteDocuments { ids: Vec<String> },
  Place { id: String, #[serde(rename = "topicId")] topic_id: Option<String>, section: LibrarySection },
  Origin { id: String, origin: Origin },
}

pub fn organization(root: &Path) -> Result<Organization, String> {
  let path = root.join(STATE_FILE);
  let mut state: Organization = if path.exists() { serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())? } else { Organization::default() };
  state.folders = Some(library_folders::migrate(&state));
  if !state.trash.is_empty() { finish_deletions(root, &mut state)?; }
  Ok(state)
}
fn save_organization(root: &Path, state: &Organization) -> Result<(), String> {
  write_json(&root.join(STATE_FILE), state)
}
// The legacy Trash field now journals irreversible deletion until file cleanup completes.
fn finish_deletions(root: &Path, state: &mut Organization) -> Result<(), String> {
  let ids: Vec<String> = state.trash.keys().cloned().collect();
  for id in &ids { document_library::validate_id(id)?; }
  for id in &ids {
    for extension in ["md", "json"] {
      let path = root.join("document-library").join(id).with_extension(extension);
      if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    }
    let history = root.join("document-history").join(id);
    if history.exists() { fs::remove_dir_all(history).map_err(|e| e.to_string())?; }
    state.trash.remove(id); state.origins.remove(id); state.sections.remove(id);
    for folder in state.folders.as_mut().unwrap() { folder.document_ids.retain(|value| value != id); }
    for topic in &mut state.topics { topic.document_ids.retain(|value| value != id); }
  }
  save_organization(root, state)
}
fn delete_documents(root: &Path, state: &mut Organization, ids: &[String]) -> Result<(), String> {
  for id in ids { document_library::read_unlocked(root, id)?; }
  for id in ids { state.trash.insert(id.clone(), chrono::Local::now().to_rfc3339()); }
  // Persist intent before removing files; failed cleanup is resumed on the next load.
  save_organization(root, state)?;
  finish_deletions(root, state)
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
fn retained_versions(root: &Path, id: &str) -> Result<Vec<(std::path::PathBuf, LibraryDocument)>, String> {
  let directory = root.join("document-history").join(id);
  let mut versions = Vec::new();
  if directory.exists() {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
      let path = entry.map_err(|e| e.to_string())?.path();
      if path.extension().and_then(|v| v.to_str()) != Some("json") { continue; }
      let doc: LibraryDocument = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
      if doc.id != id { return Err("Invalid version identity".into()); }
      versions.push((path, doc));
    }
  }
  versions.sort_by(|a, b| chrono::DateTime::parse_from_rfc3339(&b.1.updated_at).ok().cmp(&chrono::DateTime::parse_from_rfc3339(&a.1.updated_at).ok()));
  Ok(versions)
}
pub(crate) fn prune_history(root: &Path, id: &str, current_revision: &str) -> Result<(), String> {
  let mut kept = 0;
  for (path, doc) in retained_versions(root, id)? {
    if document_library::revision(&doc) == current_revision || kept >= 9 { fs::remove_file(path).map_err(|e| e.to_string())?; }
    else { kept += 1; }
  }
  Ok(())
}
pub fn history(root: &Path, id: &str) -> Result<Vec<LibraryDocument>, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  organization(root)?;
  let current = document_library::read_unlocked(root, id)?;
  let revision = document_library::revision(&current);
  // The authoritative current version stays first even after a clock/timezone change.
  let mut versions = vec![current];
  versions.extend(retained_versions(root, id)?.into_iter().map(|(_, doc)| doc).filter(|doc| document_library::revision(doc) != revision).take(9));
  for doc in &mut versions { doc.metadata.revision = Some(document_library::revision(doc)); }
  Ok(versions)
}

fn edit(root: &Path, id: &str, title: String, content: String, expected: &str) -> Result<LibraryDocumentMetadata, String> {
  let doc = document_library::read_unlocked(root, id)?;
  if document_library::revision(&doc) != expected { return Err("文档已更新，请重新打开后修改 / Document changed. Reopen it before editing.".into()); }
  document_library::publish_edited_unlocked(root, &doc.capability_id, &doc.capability_name, DocumentPublication {
    key: doc.key.clone(), title, collection_key: doc.collection_key.clone(), collection_name: doc.collection_name.clone(),
    document_date: doc.document_date.clone(), content,
  })
}
fn destination(state: &Organization, topic_id: Option<String>, mut section: LibrarySection) -> Result<(Option<usize>, LibrarySection), String> {
  if section.id.trim().is_empty() || section.id.len() > 200 || section.name.trim().is_empty() || section.name.chars().count() > 80 { return Err("栏目无效 / Invalid section".into()); }
  if section.id.starts_with("custom-") {
    section = state.custom_sections.iter().find(|item| item.id == section.id).ok_or("栏目已不存在，请重新选择 / Section no longer exists")?.clone();
  }
  if let (Some(owner), Some(requested)) = (&section.topic_id, topic_id.as_ref().filter(|id| !id.is_empty())) {
    if owner != requested { return Err("栏目属于其他专题 / Section belongs to a different topic".into()); }
  }
  let topic = match topic_id.filter(|id| !id.is_empty()).or_else(|| section.topic_id.clone()) {
    Some(id) => Some(state.topics.iter().position(|topic| topic.id == id).ok_or("专题已不存在，请重新选择 / Topic no longer exists")?),
    None => None,
  };
  section.name = section.name.trim().into();
  Ok((topic, section))
}
pub fn change(root: &Path, change: LibraryChange) -> Result<Option<LibraryDocumentMetadata>, String> {
  let _guard = DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let mut state = organization(root)?;
  match change {
    LibraryChange::Create { mut document, folder_id, topic_id, section } => {
      library_folders::destination(state.folders.as_deref().unwrap(), folder_id.as_deref())?;
      let selected_section = section.is_some();
      let (topic, section) = destination(&state, topic_id, section.unwrap_or(LibrarySection { id: "workbench.documents".into(), name: "我的文档 / My documents".into(), topic_id: None }))?;
      document.collection_key = "documents".into();
      document.collection_name = "我的文档 / My documents".into();
      let metadata = document_library::publish_edited_unlocked(root, "workbench.documents", "我的文档 / My documents", document)?;
      if let Some(index) = topic {
        let topic = &mut state.topics[index];
        if !topic.document_ids.contains(&metadata.id) { topic.document_ids.push(metadata.id.clone()); }
      }
      if selected_section { state.sections.insert(metadata.id.clone(), section); }
      if let Some(folder) = state.folders.as_mut().unwrap().iter_mut().find(|folder| Some(&folder.id) == folder_id.as_ref()) { if !folder.document_ids.contains(&metadata.id) { folder.document_ids.push(metadata.id.clone()); } }
      save_organization(root, &state)?;
      return Ok(Some(metadata));
    }
    LibraryChange::Import { mut document, folder_id } => {
      library_folders::destination(state.folders.as_deref().unwrap(), folder_id.as_deref())?;
      document.collection_key = "imports".into();
      document.collection_name = "导入资料 / Imported documents".into();
      let metadata = document_library::publish_unlocked(root, "workbench.imports", "导入 / Imports", document)?;
      if let Some(folder) = state.folders.as_mut().unwrap().iter_mut().find(|folder| Some(&folder.id) == folder_id.as_ref()) { if !folder.document_ids.contains(&metadata.id) { folder.document_ids.push(metadata.id.clone()); } }
      save_organization(root, &state)?;
      return Ok(Some(metadata));
    }
    LibraryChange::SaveFolder { mut folder } => {
      folder.name = folder.name.trim().into(); folder.parent_id = folder.parent_id.filter(|id| !id.is_empty());
      let folders = state.folders.as_mut().unwrap();
      library_folders::validate(folders, &folder)?;
      if let Some(existing) = folders.iter_mut().find(|item| item.id == folder.id) { existing.name = folder.name; existing.parent_id = folder.parent_id; }
      else { folder.document_ids.clear(); folders.push(folder); }
    }
    LibraryChange::MoveDocuments { ids, folder_id } => {
      library_folders::destination(state.folders.as_deref().unwrap(), folder_id.as_deref())?;
      for id in &ids { document_library::read_unlocked(root, id)?; }
      for folder in state.folders.as_mut().unwrap() {
        folder.document_ids.retain(|id| !ids.contains(id));
        if Some(&folder.id) == folder_id.as_ref() { for id in &ids { if !folder.document_ids.contains(id) { folder.document_ids.push(id.clone()); } } }
      }
    }
    LibraryChange::DeleteFolder { id } => {
      let folders = state.folders.as_mut().unwrap();
      library_folders::destination(folders, Some(&id))?.ok_or("文件夹已不存在 / Folder not found")?;
      let mut removed = BTreeSet::new();
      let mut pending = vec![id];
      while let Some(id) = pending.pop() {
        if removed.insert(id.clone()) { pending.extend(folders.iter().filter(|folder| folder.parent_id.as_deref() == Some(&id)).map(|folder| folder.id.clone())); }
      }
      let ids: BTreeSet<String> = folders.iter().filter(|folder| removed.contains(&folder.id)).flat_map(|folder| folder.document_ids.clone()).collect();
      for id in &ids { document_library::read_unlocked(root, id)?; }
      folders.retain(|folder| !removed.contains(&folder.id));
      return delete_documents(root, &mut state, &ids.into_iter().collect::<Vec<_>>()).map(|_| None);
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
      section.topic_id = section.topic_id.filter(|id| !id.is_empty());
      if let Some(id) = &section.topic_id {
        if !state.topics.iter().any(|topic| &topic.id == id) { return Err("专题已不存在，请重新选择 / Topic no longer exists".into()); }
      }
      if !section.id.starts_with("custom-") || section.id.len() <= 7 || section.id.len() > 107 || !section.id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') || section.name.is_empty() || section.name.chars().count() > 80 { return Err("栏目名称无效 / Invalid section name".into()); }
      if state.custom_sections.iter().any(|s| s.id == section.id || (s.topic_id == section.topic_id && s.name.to_lowercase() == section.name.to_lowercase())) { return Err("栏目已存在 / Section already exists".into()); }
      state.custom_sections.push(section);
    }
    LibraryChange::RenameSection { id, name } => {
      let current = state.custom_sections.iter().find(|section| section.id == id).ok_or("栏目已不存在，请重新选择 / Section no longer exists")?;
      let name = name.trim();
      if name.is_empty() || name.chars().count() > 80 { return Err("栏目名称无效 / Invalid section name".into()); }
      if state.custom_sections.iter().any(|section| section.id != id && section.topic_id == current.topic_id && section.name.to_lowercase() == name.to_lowercase()) { return Err("栏目已存在 / Section already exists".into()); }
      for section in state.custom_sections.iter_mut().chain(state.sections.values_mut()) {
        if section.id == id { section.name = name.into(); }
      }
    }
    LibraryChange::DeleteSection { id } => {
      if !state.custom_sections.iter().any(|section| section.id == id) { return Err("栏目已不存在，请重新选择 / Section no longer exists".into()); }
      state.custom_sections.retain(|section| section.id != id);
      state.sections.retain(|_, section| section.id != id);
    }
    LibraryChange::DeleteTopic { id } => {
      state.topics.retain(|t| t.id != id);
      for section in state.custom_sections.iter_mut().chain(state.sections.values_mut()) {
        if section.topic_id.as_deref() == Some(&id) { section.topic_id = None; }
      }
    }
    LibraryChange::DeleteDocuments { ids } => return delete_documents(root, &mut state, &ids).map(|_| None),
    LibraryChange::Place { id, topic_id, section } => {
      document_library::read_unlocked(root, &id)?;
      let (topic, section) = destination(&state, topic_id, section)?;
      if let Some(index) = topic {
        let topic = &mut state.topics[index];
        if !topic.document_ids.contains(&id) { topic.document_ids.push(id.clone()); }
      }
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
