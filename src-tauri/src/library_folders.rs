use crate::library_management::{LibraryFolder, Organization};
use std::collections::BTreeSet;

pub fn migrate(state: &Organization) -> Vec<LibraryFolder> {
  if let Some(folders) = &state.folders { return folders.clone(); }
  let mut folders = Vec::new();
  for topic in &state.topics { let name = unique_name(&folders, &topic.name, None); folders.push(LibraryFolder { id: format!("topic-{}", topic.id), name, parent_id: None, document_ids: topic.document_ids.clone() }); }
  let mut sections = state.custom_sections.clone();
  for section in state.sections.values() {
    if !sections.iter().any(|item| item.id == section.id) && section.id != "workbench.documents" && section.id != "workbench.root" { sections.push(section.clone()); }
  }
  for section in sections {
    let parent_id = section.topic_id.map(|id| format!("topic-{id}")).filter(|id| folders.iter().any(|folder| &folder.id == id));
    let document_ids: Vec<String> = state.sections.iter().filter(|(_, assigned)| assigned.id == section.id).map(|(id, _)| id.clone()).collect();
    if let Some(parent) = folders.iter_mut().find(|folder| Some(&folder.id) == parent_id.as_ref()) { parent.document_ids.retain(|id| !document_ids.contains(id)); }
    let name = unique_name(&folders, &section.name, parent_id.as_deref());
    folders.push(LibraryFolder { id: format!("section-{}", section.id), name, parent_id, document_ids });
  }
  folders
}
pub fn destination<'a>(folders: &'a [LibraryFolder], id: Option<&str>) -> Result<Option<&'a LibraryFolder>, String> {
  match id.filter(|id| !id.is_empty()) {
    Some(id) => folders.iter().find(|folder| folder.id == id).map(Some).ok_or("文件夹已不存在 / Folder not found".into()),
    None => Ok(None),
  }
}
pub fn validate(folders: &[LibraryFolder], folder: &LibraryFolder) -> Result<(), String> {
  if folder.parent_id.as_deref() == Some("") { return Err("无效的父文件夹 / Invalid parent folder".into()); }
  if folder.id.is_empty() || folder.id.len() > 200 || !folder.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') || folder.name.trim().is_empty() || folder.name.trim().chars().count() > 80 { return Err("文件夹名称无效 / Invalid folder name".into()); }
  if folders.iter().any(|item| item.id != folder.id && item.parent_id == folder.parent_id && item.name.to_lowercase() == folder.name.trim().to_lowercase()) { return Err("同名文件夹已存在 / Folder already exists".into()); }
  let mut seen = BTreeSet::from([folder.id.as_str()]);
  let mut parent = destination(folders, folder.parent_id.as_deref())?;
  while let Some(item) = parent {
    if !seen.insert(&item.id) { return Err("不能移入自身或子文件夹 / Folder cycle".into()); }
    parent = destination(folders, item.parent_id.as_deref())?;
  }
  Ok(())
}
pub fn unique_name(folders: &[LibraryFolder], requested: &str, parent_id: Option<&str>) -> String {
  let mut name = requested.to_string(); let mut suffix = 2;
  while folders.iter().any(|folder| folder.parent_id.as_deref() == parent_id && folder.name.to_lowercase() == name.to_lowercase()) { let ending = format!(" ({suffix})"); let base: String = requested.chars().take(80 - ending.len()).collect(); name = format!("{base}{ending}"); suffix += 1; }
  name
}
