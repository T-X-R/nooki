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
  fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Could not create snapshots directory")?;
  let temporary = target.with_extension("pending");
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not create source snapshot")?;
  let content = serde_json::to_vec(&documents).map_err(|_| "Could not encode source snapshot")?;
  let result = file.write_all(&content).and_then(|_| file.sync_all()).and_then(|_| fs::hard_link(&temporary, &target));
  let _ = fs::remove_file(temporary);
  result.map_err(|_| "Could not save source snapshot")?;
  Ok(documents)
}

pub fn read(root: &Path, id: &str) -> Result<Vec<SnapshotDocument>, String> {
  serde_json::from_slice(&fs::read(path(root, id)?).map_err(|_| "Source snapshot not found")?).map_err(|_| "Invalid source snapshot".into())
}
pub fn source(root: &Path, id: &str, document_id: &str) -> Result<SnapshotDocument, String> {
  read(root, id)?.into_iter().find(|doc| doc.reference["documentId"] == document_id).ok_or_else(|| "Document not found in source snapshot".into())
}
