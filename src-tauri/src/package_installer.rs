use crate::capability_runtime::{validate_manifest, CapabilityManifest};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};

const MAX_ARCHIVE_BYTES: usize = 12 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackagePayload {
  pub manifest: CapabilityManifest,
  pub entry: String,
  pub styles: String,
}

pub fn inspect_archive(bytes: &[u8]) -> Result<PackagePayload, String> {
  if bytes.len() > MAX_ARCHIVE_BYTES { return Err("能力包不能超过 12 MB".into()); }
  let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "能力包不是有效的 ZIP")?;
  if !(2..=3).contains(&archive.len()) { return Err("能力包只能包含 manifest.json、entry.js 和可选的 style.css".into()); }
  let mut files = std::collections::BTreeMap::new();
  for index in 0..archive.len() {
    let file = archive.by_index(index).map_err(|_| "无法读取 ZIP 条目")?;
    let name = file.name().to_string();
    if !matches!(name.as_str(), "manifest.json" | "entry.js" | "style.css")
      || file.is_dir() || file.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000)
      || file.size() > MAX_ENTRY_BYTES || files.contains_key(&name) {
      return Err("能力包包含无效路径、重复条目、链接或过大的文件".into());
    }
    let mut content = String::new();
    file.take(MAX_ENTRY_BYTES + 1).read_to_string(&mut content).map_err(|_| "能力包文件必须为 UTF-8 文本")?;
    if content.len() as u64 > MAX_ENTRY_BYTES { return Err("能力包文件过大".into()); }
    files.insert(name, content);
  }
  let manifest: CapabilityManifest = serde_json::from_str(files.get("manifest.json").ok_or("缺少 manifest.json")?)
    .map_err(|_| "Manifest 格式无效")?;
  validate_manifest(&manifest)?;
  let entry = files.remove("entry.js").filter(|entry| !entry.trim().is_empty()).ok_or("缺少 entry.js")?;
  Ok(PackagePayload { manifest, entry, styles: files.remove("style.css").unwrap_or_default() })
}
