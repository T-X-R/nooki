use chrono::{Datelike, Local, NaiveDate, SecondsFormat};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

const LIBRARY_DIR: &str = "document-library";
const MAX_DOCUMENT_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPublication {
  pub key: String,
  pub title: String,
  pub collection_key: String,
  pub collection_name: String,
  pub document_date: String,
  pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocumentMetadata {
  pub id: String,
  pub capability_id: String,
  pub capability_name: String,
  pub collection_key: String,
  pub collection_name: String,
  pub key: String,
  pub title: String,
  pub document_date: String,
  pub format: String,
  pub size_bytes: usize,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
  #[serde(flatten)]
  pub metadata: LibraryDocumentMetadata,
  pub content: String,
}

impl std::ops::Deref for LibraryDocument {
  type Target = LibraryDocumentMetadata;

  fn deref(&self) -> &Self::Target {
    &self.metadata
  }
}

pub fn publish_document(
  data_dir: &Path,
  capability_id: &str,
  capability_name: &str,
  input: DocumentPublication,
) -> Result<LibraryDocumentMetadata, String> {
  validate_slug(&input.key, "资料库文档键格式无效")?;
  validate_slug(&input.collection_key, "资料库集合键格式无效")?;
  validate_text(&input.title, 240, "资料库文档标题无效")?;
  validate_text(&input.collection_name, 120, "资料库集合名称无效")?;
  if input.content.trim().is_empty() || input.content.len() > MAX_DOCUMENT_BYTES {
    return Err("资料库文档内容无效".into());
  }
  let date = NaiveDate::parse_from_str(&input.document_date, "%Y-%m-%d")
    .map_err(|_| "资料库文档日期格式无效".to_string())?;
  let year = format!("{:04}", date.year());
  let month = format!("{:02}", date.month());
  let directory = data_dir
    .join(LIBRARY_DIR)
    .join(capability_id)
    .join(&input.collection_key)
    .join(&year)
    .join(&month);
  let content_path = directory.join(format!("{}.md", input.key));
  let metadata_path = directory.join(format!("{}.json", input.key));
  let id = format!(
    "{}/{}/{}/{}/{}",
    capability_id, input.collection_key, year, month, input.key,
  );
  let now = Local::now().to_rfc3339_opts(SecondsFormat::Secs, false);
  let created_at = read_metadata(&metadata_path)
    .ok()
    .filter(|metadata| metadata.id == id)
    .map(|metadata| metadata.created_at)
    .unwrap_or_else(|| now.clone());
  let metadata = LibraryDocumentMetadata {
    id,
    capability_id: capability_id.into(),
    capability_name: capability_name.into(),
    collection_key: input.collection_key,
    collection_name: input.collection_name,
    key: input.key,
    title: input.title,
    document_date: input.document_date,
    format: "markdown".into(),
    size_bytes: input.content.len(),
    created_at,
    updated_at: now,
  };

  fs::create_dir_all(&directory).map_err(|_| "无法创建资料库目录".to_string())?;
  atomic_write(&content_path, input.content.as_bytes(), "无法保存资料库文档")?;
  let metadata_source = serde_json::to_vec_pretty(&metadata)
    .map_err(|_| "无法序列化资料库文档信息".to_string())?;
  atomic_write(&metadata_path, &metadata_source, "无法保存资料库文档信息")?;
  Ok(metadata)
}

pub fn list_documents(data_dir: &Path) -> Result<Vec<LibraryDocumentMetadata>, String> {
  let root = data_dir.join(LIBRARY_DIR);
  if !root.is_dir() {
    return Ok(Vec::new());
  }
  let mut documents = Vec::new();
  collect_metadata(&root, &mut documents)?;
  documents.sort_by(|left, right| {
    right
      .document_date
      .cmp(&left.document_date)
      .then_with(|| left.capability_name.cmp(&right.capability_name))
      .then_with(|| left.collection_name.cmp(&right.collection_name))
      .then_with(|| left.title.cmp(&right.title))
  });
  Ok(documents)
}

pub fn read_document(data_dir: &Path, id: &str) -> Result<LibraryDocument, String> {
  let parts = id.split('/').collect::<Vec<_>>();
  if parts.len() != 5
    || !valid_capability_id(parts[0])
    || !valid_slug(parts[1])
    || !valid_year(parts[2])
    || !valid_month(parts[3])
    || !valid_slug(parts[4])
  {
    return Err("资料库文档 ID 无效".into());
  }
  let directory = data_dir
    .join(LIBRARY_DIR)
    .join(parts[0])
    .join(parts[1])
    .join(parts[2])
    .join(parts[3]);
  let metadata = read_metadata(&directory.join(format!("{}.json", parts[4])))?;
  if metadata.id != id {
    return Err("资料库文档信息不一致".into());
  }
  let content = fs::read_to_string(directory.join(format!("{}.md", parts[4])))
    .map_err(|_| "无法读取资料库文档".to_string())?;
  Ok(LibraryDocument { metadata, content })
}

fn collect_metadata(
  directory: &Path,
  documents: &mut Vec<LibraryDocumentMetadata>,
) -> Result<(), String> {
  let entries = fs::read_dir(directory).map_err(|_| "无法读取资料库目录".to_string())?;
  for entry in entries {
    let entry = entry.map_err(|_| "无法读取资料库目录".to_string())?;
    let path = entry.path();
    if path.is_dir() {
      collect_metadata(&path, documents)?;
    } else if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
      documents.push(read_metadata(&path)?);
    }
  }
  Ok(())
}

fn read_metadata(path: &Path) -> Result<LibraryDocumentMetadata, String> {
  let source = fs::read(path).map_err(|_| "无法读取资料库文档信息".to_string())?;
  serde_json::from_slice(&source).map_err(|_| "无法解析资料库文档信息".to_string())
}

fn atomic_write(path: &Path, source: &[u8], error_message: &str) -> Result<(), String> {
  let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("data");
  let temporary = path.with_extension(format!("{extension}.tmp"));
  fs::write(&temporary, source).map_err(|_| error_message.to_string())?;
  fs::rename(&temporary, path).map_err(|_| error_message.to_string())
}

fn validate_slug(value: &str, message: &str) -> Result<(), String> {
  if valid_slug(value) { Ok(()) } else { Err(message.into()) }
}

fn valid_slug(value: &str) -> bool {
  !value.is_empty()
    && value.len() <= 100
    && value.chars().all(|character| {
      character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    })
}

fn valid_capability_id(value: &str) -> bool {
  value.contains('.') && value.split('.').all(valid_slug)
}

fn valid_year(value: &str) -> bool {
  value.len() == 4 && value.chars().all(|character| character.is_ascii_digit())
}

fn valid_month(value: &str) -> bool {
  value.len() == 2
    && value.chars().all(|character| character.is_ascii_digit())
    && matches!(value.parse::<u8>(), Ok(1..=12))
}

fn validate_text(value: &str, max_len: usize, message: &str) -> Result<(), String> {
  if !value.trim().is_empty() && value.len() <= max_len {
    Ok(())
  } else {
    Err(message.into())
  }
}

// Metadata filtering stays in the platform tree; this scan only adds body matches.
pub fn search_content(data_dir: &Path, query: &str) -> Result<Vec<String>, String> {
  let query = query.trim().to_lowercase();
  if query.is_empty() { return Ok(Vec::new()); }
  let mut ids = Vec::new();
  for metadata in list_documents(data_dir)? {
    if read_document(data_dir, &metadata.id)?.content.to_lowercase().contains(&query) { ids.push(metadata.id); }
  }
  Ok(ids)
}
