use crate::{capability_runtime::PlatformState, document_library};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet}, fs, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReference {
  pub kind: String,
  pub document_id: String,
  pub title: String,
  pub grant_id: String,
  pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedDocument {
  pub reference: DocumentReference,
  pub document_date: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentGrant {
  pub id: String,
  pub capability_id: String,
  pub capability_version: String,
  pub created_at: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub purpose: Option<String>,
  pub documents: Vec<SelectedDocument>,
}

fn path(data_dir: &Path, id: &str) -> Result<std::path::PathBuf, String> {
  if id.is_empty() || id.len() > 100 || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') {
    return Err("Invalid document grant ID".into());
  }
  Ok(data_dir.join("document-grants").join(format!("{id}.json")))
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredGrant {
  #[serde(flatten)] grant: DocumentGrant,
  #[serde(default)] activation_generation: Option<String>,
}
impl StoredGrant {
  fn authorizes(&self, context: &crate::capability_authority::InvocationContext) -> bool {
    self.grant.capability_id == context.capability_id && self.grant.capability_version == context.capability_version
      && self.activation_generation.as_ref() == Some(&context.generation)
  }
}
fn read(data_dir: &Path, id: &str) -> Result<StoredGrant, String> {
  let source = fs::read(path(data_dir, id)?).map_err(|_| "Document grant not found")?;
  let record: StoredGrant = serde_json::from_slice(&source).map_err(|_| "Invalid document grant")?;
  if record.grant.id != id { return Err("Invalid document grant identity".into()); }
  Ok(record)
}
fn metadata(mut grant: DocumentGrant) -> DocumentGrant {
  for document in &mut grant.documents { document.content = None; }
  grant
}

pub fn grant(state: &PlatformState, data_dir: &Path, capability_id: &str, ids: Vec<String>, id: &str) -> Result<DocumentGrant, String> {
  grant_for_selection(state, data_dir, capability_id, ids, id, None)
}
pub(crate) fn grant_for_selection(state: &PlatformState, data_dir: &Path, capability_id: &str, ids: Vec<String>, id: &str,
    selection: Option<&crate::document_selection::Selection>) -> Result<DocumentGrant, String> {
  state.prepare_document_grant(capability_id)?;
  let ids: BTreeSet<_> = ids.into_iter().collect();
  if ids.is_empty() || ids.len() > 50 { return Err("Select between 1 and 50 documents".into()); }
  let target = path(data_dir, id)?;
  state.with_document_authority(capability_id, |context| {
    if selection.is_some_and(|selection| selection.context != *context) {
      return Err("PERMISSION_DENIED: installation changed while selecting documents".into());
    }
    if revoked(data_dir, id)? { return Err("PERMISSION_DENIED: document grant is revoked".into()); }
    if target.try_exists().map_err(|e| e.to_string())? {
      let existing = read(data_dir, id)?;
      let previous: BTreeSet<_> = existing.grant.documents.iter().map(|doc| doc.reference.document_id.clone()).collect();
      if !existing.authorizes(context) || previous != ids { return Err("CONFLICT: document grant identity was used for a different selection".into()); }
      fs::File::open(&target).and_then(|file| file.sync_all())
        .map_err(|_| "OUTCOME_UNKNOWN: document snapshot durability was not confirmed")?;
      confirm_directory(target.parent().unwrap())?;
      confirm_directory(data_dir)?;
      return Ok(metadata(existing.grant));
    }
    let mut documents = Vec::new();
    let mut bytes = 0;
    crate::library_management::organization(data_dir)?;
    for document_id in ids {
      let doc = document_library::read_unlocked(data_dir, &document_id)?;
      bytes += doc.content.len();
      if bytes > 8_000_000 { return Err("Selected documents exceed 8 MB".into()); }
      documents.push(SelectedDocument {
        reference: DocumentReference { kind: "library-document".into(), document_id, title: doc.title.clone(), grant_id: id.into(), revision: doc.updated_at.clone() },
        document_date: doc.document_date.clone(), content: Some(doc.content),
      });
    }
    let grant = DocumentGrant { id: id.into(), capability_id: capability_id.into(), capability_version: context.capability_version.clone(), created_at: chrono::Local::now().to_rfc3339(), purpose: selection.map(|selection| selection.purpose.clone()), documents };
    fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Could not create document grants directory")?;
    let record = StoredGrant { grant: grant.clone(), activation_generation: Some(context.generation.clone()) };
    let source = serde_json::to_vec(&record).map_err(|_| "Could not serialize document grant")?;
    // Exclusive creation: a snapshot ID never changes its content.
    use std::io::Write;
    let temporary = target.with_extension("pending");
    // The data/authority locks exclude another publisher. A crash before the hard link leaves no grant.
    match fs::remove_file(&temporary) {
      Ok(()) => (),
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
      Err(_) => return Err("Could not clear incomplete document grant".into()),
    }
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not create document grant")?;
    let result = file.write_all(&source).and_then(|_| file.sync_all()).and_then(|_| fs::hard_link(&temporary, &target));
    let _ = fs::remove_file(&temporary);
    result.map_err(|_| "Could not save document grant")?;
    confirm_directory(target.parent().unwrap())?;
    confirm_directory(data_dir)?;
    Ok(metadata(grant))
  })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentAccess { pub grant: DocumentGrant, pub status: &'static str }
pub(crate) fn access_records(state: &PlatformState) -> Result<Vec<DocumentAccess>, String> {
  let root = state.data_dir();
  let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing; retry later")?;
  crate::user_data::ensure_restore_complete(root)?;
  let _fence = crate::capability_authority::fence(root)?;
  let _library = crate::library_management::DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let directory = root.join("document-grants");
  if !directory.try_exists().map_err(|e| e.to_string())? { return Ok(Vec::new()); }
  let mut records = Vec::new();
  for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
    let path = entry.map_err(|e| e.to_string())?.path();
    if path.extension().and_then(|extension| extension.to_str()) != Some("json") { continue; }
    let id = path.file_stem().and_then(|stem| stem.to_str()).ok_or("Invalid document grant ID")?;
    let record = read(root, id)?;
    let status = if revoked(root, id)? { "revoked" }
      else if state.document_context(&record.grant.capability_id).is_ok_and(|context| record.authorizes(&context)) { "active" }
      else { "inactive" };
    records.push(DocumentAccess { grant: metadata(record.grant), status });
  }
  records.sort_by(|a,b| b.grant.created_at.cmp(&a.grant.created_at));
  Ok(records)
}

pub fn list(state: &PlatformState, data_dir: &Path, capability_id: &str) -> Result<Vec<DocumentGrant>, String> {
  state.with_document_authority(capability_id, |context| {
    let root = data_dir.join("document-grants");
    if !root.try_exists().map_err(|e| e.to_string())? { return Ok(Vec::new()); }
    let mut grants = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| "Could not list document grants")? {
      let entry = entry.map_err(|_| "Could not list document grants")?;
      let path = entry.path();
      if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
      let id = path.file_stem().and_then(|s| s.to_str()).ok_or("Invalid document grant")?;
      let record = read(data_dir, id)?;
      if record.authorizes(context) && !revoked(data_dir, id)? { grants.push(metadata(record.grant)); }
    }
    grants.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(grants)
  })
}

pub fn read_selected(state: &PlatformState, data_dir: &Path, capability_id: &str, grant_id: &str, document_id: &str) -> Result<SelectedDocument, String> {
  state.with_document_authority(capability_id, |context| {
    let record = read(data_dir, grant_id)?;
    if !record.authorizes(context) || revoked(data_dir, grant_id)? {
      return Err("PERMISSION_DENIED: document grant is revoked or belongs to another installation; select documents again".into());
    }
    source(record.grant, document_id)
  })
}

// The board worker already holds task-data.lock and the authority fence through its commit.
// Return canonical references only; a task is user-owned and creation does not delegate execution.
pub(crate) fn board_sources(root: &Path, context: &crate::capability_authority::InvocationContext,
    references: &[DocumentReference]) -> Result<Vec<serde_json::Value>, String> {
  Ok(task_documents(root, context, references)?.into_iter().map(|selected| {
    let canonical = selected.reference;
    serde_json::json!({"id":canonical.document_id,"title":canonical.title,"reference":canonical})
  }).collect())
}
// Caller holds task-data and authority locks. Capture exact approved text for retained task data.
pub(crate) fn task_documents(root: &Path, context: &crate::capability_authority::InvocationContext,
    references: &[DocumentReference]) -> Result<Vec<SelectedDocument>, String> {
  if references.is_empty() { return Ok(Vec::new()); }
  if crate::capability_runtime::document_context(root, &context.capability_id)? != *context {
    return Err("PERMISSION_DENIED: document installation changed".into());
  }
  let _library = crate::library_management::DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let denied = "PERMISSION_DENIED: source is not an authorized selected snapshot";
  let mut sources = Vec::new();
  let mut bytes = 0usize;
  for reference in references {
    let record = read(root, &reference.grant_id).map_err(|_| denied)?;
    if !record.authorizes(context) || revoked(root, &reference.grant_id)? { return Err(denied.into()); }
    let selected = source(record.grant, &reference.document_id).map_err(|_| denied)?;
    let canonical = &selected.reference;
    if canonical.kind != reference.kind || canonical.title != reference.title || canonical.revision != reference.revision
      || canonical.grant_id != reference.grant_id { return Err(denied.into()); }
    bytes += selected.content.as_ref().ok_or(denied)?.len();
    if bytes > 8_000_000 { return Err("RESOURCE_LIMIT: selected task inputs exceed 8 MB".into()); }
    sources.push(selected);
  }
  Ok(sources)
}

fn source(grant: DocumentGrant, document_id: &str) -> Result<SelectedDocument, String> {
  grant.documents.into_iter().find(|doc| doc.reference.document_id == document_id)
    .ok_or_else(|| "Document is outside the authorized selection".into())
}
pub fn read_source(data_dir: &Path, grant_id: &str, document_id: &str) -> Result<SelectedDocument, String> {
  let _data = crate::task_worker::data_lock(data_dir)?.ok_or("RESOURCE_BUSY: user data is changing; retry later")?;
  crate::user_data::ensure_restore_complete(data_dir)?;
  let _library = crate::library_management::DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  source(read(data_dir, grant_id)?.grant, document_id)
}

// User task capture already holds task-data.lock. Retained citations do not reactivate package access.
pub(crate) fn task_source(root: &Path, reference: &DocumentReference) -> Result<SelectedDocument, String> {
  let _library = crate::library_management::DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  let selected = source(read(root, &reference.grant_id)?.grant, &reference.document_id)?;
  if selected.reference != *reference || selected.content.is_none() { return Err("Selected task reference differs from its retained snapshot".into()); }
  Ok(selected)
}

// Authority decisions are deliberately outside the data-restore roots. Restoring an older snapshot
// must not undo a local revoke. Restored grants on another installation fail their generation check.
fn revocation_path(root: &Path, id: &str) -> Result<std::path::PathBuf, String> {
  path(root, id)?;
  Ok(root.join("document-grant-revocations").join(format!("{id}.json")))
}
fn revoked(root: &Path, id: &str) -> Result<bool, String> {
  let marker = revocation_path(root, id)?;
  // Any present marker denies access, including an unreadable/malformed one. Never fail open.
  match fs::symlink_metadata(marker) {
    Ok(_) => Ok(true),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
    Err(error) => Err(error.to_string()),
  }
}
fn confirm_directory(directory: &Path) -> Result<(), String> {
  #[cfg(unix)]
  fs::File::open(directory).and_then(|file| file.sync_all())
    .map_err(|_| "OUTCOME_UNKNOWN: document authority changed but durability was not confirmed")?;
  Ok(())
}
pub fn revoke(root: &Path, id: &str) -> Result<(), String> {
  let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing; retry later")?;
  crate::user_data::ensure_restore_complete(root)?;
  let _fence = crate::capability_authority::fence(root)?;
  let _library = crate::library_management::DATA_LOCK.lock().map_err(|_| "Library unavailable")?;
  if !revoked(root, id)? { read(root, id)?; }
  write_revocation(root, id)
}

// Caller holds the process-shared data lock and DATA_LOCK, including during restore/recovery.
fn write_revocation(root: &Path, id: &str) -> Result<(), String> {
  use std::io::Write;
  let marker = revocation_path(root, id)?;
  let parent = marker.parent().unwrap();
  fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  if !revoked(root, id)? {
    let pending = marker.with_extension("pending");
    let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(b"true").and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    fs::rename(pending, &marker).map_err(|e| e.to_string())?;
  }
  confirm_directory(parent)?;
  confirm_directory(root)
}

// Restoring data must not recycle a previously published snapshot identity. Persist revocations
// before replacing managed roots; a failed restore may revoke access, but can never revive it.
pub(crate) fn invalidate_replaced(root: &Path, replacement: &BTreeMap<String, String>) -> Result<(), String> {
  let directory = root.join("document-grants");
  if !directory.try_exists().map_err(|e| e.to_string())? { return Ok(()); }
  for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
    let path = entry.map_err(|e| e.to_string())?.path();
    if path.extension().and_then(|extension| extension.to_str()) != Some("json") { continue; }
    let id = path.file_stem().and_then(|stem| stem.to_str()).ok_or("Invalid document grant ID")?;
    let current = fs::read(&path).map_err(|e| e.to_string())?;
    if replacement.get(&format!("document-grants/{id}.json")).map(String::as_bytes) != Some(current.as_slice()) {
      write_revocation(root, id)?;
    }
  }
  Ok(())
}
