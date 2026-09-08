use crate::{capability_runtime::{CapabilityPermission, PlatformState}, document_library};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
  pub documents: Vec<SelectedDocument>,
}

fn path(data_dir: &Path, id: &str) -> Result<std::path::PathBuf, String> {
  if id.is_empty() || id.len() > 100 || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') {
    return Err("Invalid document grant ID".into());
  }
  Ok(data_dir.join("document-grants").join(format!("{id}.json")))
}
fn read(data_dir: &Path, id: &str) -> Result<DocumentGrant, String> {
  let source = fs::read(path(data_dir, id)?).map_err(|_| "Document grant not found")?;
  serde_json::from_slice(&source).map_err(|_| "Invalid document grant".into())
}
fn metadata(mut grant: DocumentGrant) -> DocumentGrant {
  for document in &mut grant.documents { document.content = None; }
  grant
}
fn version(state: &PlatformState, id: &str) -> Result<String, String> {
  state.authorize_permission(id, CapabilityPermission::DocumentsReadSelected)?;
  state.list_capabilities()?.into_iter().find(|item| item.manifest.id == id)
    .map(|item| item.manifest.version).ok_or_else(|| "Capability not found".into())
}

pub fn grant(state: &PlatformState, data_dir: &Path, capability_id: &str, ids: Vec<String>, id: &str) -> Result<DocumentGrant, String> {
  let capability_version = version(state, capability_id)?;
  let ids: BTreeSet<_> = ids.into_iter().collect();
  if ids.is_empty() || ids.len() > 50 { return Err("Select between 1 and 50 documents".into()); }
  let target = path(data_dir, id)?;
  if target.exists() { return Err("Document grant already exists".into()); }
  let mut documents = Vec::new();
  let mut bytes = 0;
  for document_id in ids {
    let doc = document_library::read_document(data_dir, &document_id)?;
    bytes += doc.content.len();
    if bytes > 8_000_000 { return Err("Selected documents exceed 8 MB".into()); }
    documents.push(SelectedDocument {
      reference: DocumentReference { kind: "library-document".into(), document_id, title: doc.title.clone(), grant_id: id.into(), revision: doc.updated_at.clone() },
      document_date: doc.document_date.clone(), content: Some(doc.content),
    });
  }
  let grant = DocumentGrant { id: id.into(), capability_id: capability_id.into(), capability_version, created_at: chrono::Local::now().to_rfc3339(), documents };
  fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Could not create document grants directory")?;
  let source = serde_json::to_vec(&grant).map_err(|_| "Could not serialize document grant")?;
  // Exclusive creation: a snapshot ID never changes its content.
  use std::io::Write;
  let temporary = target.with_extension("pending");
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not create document grant")?;
  let result = file.write_all(&source).and_then(|_| file.sync_all()).and_then(|_| fs::hard_link(&temporary, &target));
  let _ = fs::remove_file(&temporary);
  result.map_err(|_| "Could not save document grant")?;
  Ok(metadata(grant))
}

pub fn list(state: &PlatformState, data_dir: &Path, capability_id: &str) -> Result<Vec<DocumentGrant>, String> {
  let capability_version = version(state, capability_id)?;
  let root = data_dir.join("document-grants");
  if !root.exists() { return Ok(Vec::new()); }
  let mut grants = Vec::new();
  for entry in fs::read_dir(root).map_err(|_| "Could not list document grants")? {
    let entry = entry.map_err(|_| "Could not list document grants")?;
    let path = entry.path();
    if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
    let grant = read(data_dir, path.file_stem().and_then(|s| s.to_str()).ok_or("Invalid document grant")?)?;
    if grant.capability_id == capability_id && grant.capability_version == capability_version { grants.push(metadata(grant)); }
  }
  grants.sort_by(|a, b| a.created_at.cmp(&b.created_at));
  Ok(grants)
}

pub fn read_selected(state: &PlatformState, data_dir: &Path, capability_id: &str, grant_id: &str, document_id: &str) -> Result<SelectedDocument, String> {
  let capability_version = version(state, capability_id)?;
  let grant = read(data_dir, grant_id)?;
  if grant.capability_id != capability_id || grant.capability_version != capability_version { return Err("Document grant belongs to another capability or version".into()); }
  source(grant, document_id)
}
fn source(grant: DocumentGrant, document_id: &str) -> Result<SelectedDocument, String> {
  grant.documents.into_iter().find(|doc| doc.reference.document_id == document_id)
    .ok_or_else(|| "Document is outside the authorized selection".into())
}
pub fn read_source(data_dir: &Path, grant_id: &str, document_id: &str) -> Result<SelectedDocument, String> {
  source(read(data_dir, grant_id)?, document_id)
}
