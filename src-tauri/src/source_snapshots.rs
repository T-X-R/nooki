use crate::document_library;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDocument {
  pub reference: serde_json::Value,
  pub document_date: String,
  pub content: String,
}

fn path(root: &Path, id: &str) -> Result<PathBuf, String> {
  if id.is_empty() || id.len() > 100 || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') { return Err("Invalid snapshot ID".into()); }
  Ok(root.join("source-snapshots").join(format!("{id}.json")))
}

pub fn capture(root: &Path, id: &str, ids: &[String]) -> Result<Vec<SnapshotDocument>, String> {
  let target = path(root, id)?;
  let requested: std::collections::BTreeSet<_> = ids.iter().cloned().collect();
  if requested.len() > 50 { return Err("Select at most 50 documents".into()); }
  // An interrupted task can reuse the same snapshot without recapturing changed originals.
  if target.exists() {
    let documents = read(root, id)?;
    let existing: std::collections::BTreeSet<_> = documents.iter().filter_map(|d| d.reference["documentId"].as_str().map(String::from)).collect();
    return if existing == requested { Ok(documents) } else { Err("Snapshot selection differs".into()) };
  }
  let mut documents = Vec::new();
  let mut bytes = 0;
  for document_id in requested {
    let doc = document_library::read_document(root, &document_id)?;
    bytes += doc.content.len();
    if bytes > 8_000_000 { return Err("Selected documents exceed 8 MB".into()); }
    documents.push(SnapshotDocument {
      reference: serde_json::json!({"kind":"library-document", "documentId":document_id, "title":doc.title, "revision":doc.updated_at, "snapshotId":id}),
      document_date: doc.document_date.clone(), content: doc.content,
    });
  }
  save(&target, &documents)?;
  Ok(documents)
}

fn save(target: &Path, documents: &[SnapshotDocument]) -> Result<(), String> {
  fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Could not create snapshots directory")?;
  let temporary = target.with_extension("pending");
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not create source snapshot")?;
  let content = serde_json::to_vec(&documents).map_err(|_| "Could not encode source snapshot")?;
  let result = file.write_all(&content).and_then(|_| file.sync_all()).and_then(|_| fs::hard_link(&temporary, &target));
  let _ = fs::remove_file(temporary);
  result.map_err(|_| "Could not save source snapshot")?;
  Ok(())
}

#[derive(Deserialize, PartialEq, Eq)]
struct TaskSource {
  id: String,
  title: String,
  reference: Option<crate::document_grants::DocumentReference>,
}

fn task_sources(value: &serde_json::Value) -> Result<Vec<TaskSource>, String> {
  let values = value.as_array().filter(|sources| sources.len() <= 50).ok_or("Invalid task references")?;
  let mut ids = std::collections::BTreeSet::new();
  let mut sources = Vec::new();
  for value in values {
    if !value.is_object() { return Err("Invalid task reference object".into()); }
    let source: TaskSource = serde_json::from_value(value.clone()).map_err(|_| "Invalid task reference")?;
    document_library::validate_id(&source.id)?;
    if !ids.insert(source.id.clone()) { return Err("Duplicate task reference".into()); }
    if let Some(reference) = value.get("reference") {
      if reference.as_object().is_none_or(|object| object.len() != 5) { return Err("Invalid selected task reference".into()); }
      let reference = source.reference.as_ref().ok_or("Invalid selected task reference")?;
      if reference.kind != "library-document" || reference.document_id != source.id || reference.title != source.title
        || reference.revision.is_empty() || reference.grant_id.is_empty() || reference.grant_id.len() > 100
        || !reference.grant_id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') {
        return Err("Invalid selected task reference".into());
      }
    }
    sources.push(source);
  }
  Ok(sources)
}

pub(crate) fn validate_task_sources(value: &serde_json::Value) -> Result<(), String> {
  task_sources(value).map(|_| ())
}

pub(crate) fn check_task_source_selection(saved: &serde_json::Value, requested: &serde_json::Value) -> Result<(), String> {
  let mut saved = task_sources(saved)?;
  let mut requested = task_sources(requested)?;
  saved.sort_by(|a, b| a.id.cmp(&b.id));
  requested.sort_by(|a, b| a.id.cmp(&b.id));
  if saved != requested { return Err("Snapshot selection differs".into()); }
  Ok(())
}

// Caller holds task-data.lock. Full source identities, unlike ID-only conversation replay, must match.
pub(crate) fn capture_task(root: &Path, id: &str, sources: &serde_json::Value) -> Result<Vec<SnapshotDocument>, String> {
  crate::user_data::ensure_restore_complete(root)?;
  let sources = task_sources(sources)?;
  let target = path(root, id)?;
  let existing = if target.try_exists().map_err(|e| e.to_string())? { Some(read(root, id)?) } else { None };
  if existing.as_ref().is_some_and(|documents| documents.len() != sources.len()) { return Err("Snapshot selection differs".into()); }
  let mut documents = Vec::new();
  let mut bytes = 0;
  for source in sources {
    let document = if let Some(existing) = &existing {
      let document = existing.iter().find(|doc| doc.reference["documentId"] == source.id).ok_or("Snapshot selection differs")?;
      let matches = match &source.reference {
        Some(reference) => serde_json::from_value::<crate::document_grants::DocumentReference>(document.reference.clone()).is_ok_and(|saved| saved == *reference),
        None => document.reference.get("grantId").is_none(),
      };
      if !matches || document.reference["snapshotId"] != id { return Err("Snapshot selection differs".into()); }
      document.clone()
    } else if let Some(reference) = &source.reference {
      let selected = crate::document_grants::task_source(root, reference)?;
      let mut reference = serde_json::to_value(selected.reference).map_err(|e| e.to_string())?;
      reference["snapshotId"] = serde_json::json!(id);
      SnapshotDocument { reference, document_date: selected.document_date, content: selected.content.ok_or("Selected source content is missing")? }
    } else {
      let doc = document_library::read_document(root, &source.id)?;
      SnapshotDocument { reference: serde_json::json!({"kind":"library-document","documentId":source.id,"title":doc.title,"revision":doc.updated_at,"snapshotId":id}), document_date: doc.document_date.clone(), content: doc.content }
    };
    bytes += document.content.len();
    if bytes > 8_000_000 { return Err("Selected documents exceed 8 MB".into()); }
    documents.push(document);
  }
  if existing.is_none() { save(&target, &documents)?; }
  Ok(documents)
}

pub fn read(root: &Path, id: &str) -> Result<Vec<SnapshotDocument>, String> {
  serde_json::from_slice(&fs::read(path(root, id)?).map_err(|_| "Source snapshot not found")?).map_err(|_| "Invalid source snapshot".into())
}
pub fn source(root: &Path, id: &str, document_id: &str) -> Result<SnapshotDocument, String> {
  read(root, id)?.into_iter().find(|doc| doc.reference["documentId"] == document_id).ok_or_else(|| "Document not found in source snapshot".into())
}
