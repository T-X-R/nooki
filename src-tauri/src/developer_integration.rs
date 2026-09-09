use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::{Cursor, Write}, path::{Path, PathBuf}, sync::Mutex};

pub const SKILL_NAME: &str = "workbench-capability-dev";
const RECEIPT: &str = ".workbench-integration.json";
const BACKUP: &str = ".workbench-capability-dev.previous";
type Files = BTreeMap<String, String>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitInfo {
  pub version: String,
  pub platform_version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
  pub tool: String,
  pub detected: bool,
  pub directory: String,
  pub status: String,
  pub installed_version: Option<String>,
  pub bundled_version: String,
  pub platform_version: String,
  pub changed_files: Vec<String>,
  pub detail: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct Receipt {
  version: String,
  files: BTreeMap<String, String>,
}

pub fn bundled_files() -> Files {
  serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/developer-kit.json"))).expect("valid built-in developer kit")
}

fn digest(content: &[u8]) -> String { format!("{:x}", Sha256::digest(content)) }

fn hashes(files: &Files) -> BTreeMap<String, String> {
  files.iter().map(|(path, content)| (path.clone(), digest(content.as_bytes()))).collect()
}

// Inspect only our skill directory. Never read credentials or execute a tool binary.
fn read_hashes(directory: &Path) -> Result<BTreeMap<String, String>, String> {
  fn visit(root: &Path, directory: &Path, files: &mut BTreeMap<String, String>) -> Result<(), String> {
    let metadata = fs::symlink_metadata(directory).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() { return Err("Skill directory must be a regular directory, not a link".into()); }
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
      let entry = entry.map_err(|e| e.to_string())?;
      let path = entry.path();
      let name = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
      let kind = entry.file_type().map_err(|e| e.to_string())?;
      if kind.is_symlink() { return Err(format!("Skill contains a link: {name}")); }
      if kind.is_dir() { visit(root, &path, files)?; }
      else if kind.is_file() {
        if name != RECEIPT { files.insert(name, digest(&fs::read(&path).map_err(|e| e.to_string())?)); }
      } else { return Err(format!("Skill contains an unsupported file: {name}")); }
    }
    Ok(())
  }
  let mut files = BTreeMap::new();
  visit(directory, directory, &mut files)?;
  Ok(files)
}

pub struct DeveloperIntegration {
  home: PathBuf,
  codex_home: PathBuf,
  claude_home: PathBuf,
  binary_directories: Vec<PathBuf>,
  codex_app: PathBuf,
  codex_override: Option<PathBuf>,
  files: Files,
  gate: Mutex<()>,
}

impl DeveloperIntegration {
  pub fn new(home: PathBuf, files: Files) -> Self {
    Self { codex_home: home.join(".codex"), claude_home: home.join(".claude"),
      binary_directories: vec![home.join(".local/bin"), home.join(".npm-global/bin"), home.join(".hermes/node/bin"), PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")],
      codex_app: PathBuf::from("/Applications/Codex.app"), codex_override: None,
      home, files, gate: Mutex::new(()) }
  }

  pub fn from_environment() -> Result<Self, String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).filter(|p| p.is_absolute()).ok_or("Cannot locate the current user's home directory")?;
    let mut integration = Self::new(home, bundled_files());
    if let Some(path) = std::env::var_os("CODEX_HOME").map(PathBuf::from).filter(|p| p.is_absolute()) { integration.codex_home = path; }
    if let Some(path) = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).filter(|p| p.is_absolute()) { integration.claude_home = path; }
    integration.codex_override = std::env::var_os("CODEX_BIN").map(PathBuf::from);
    if let Some(path) = std::env::var_os("PATH") { integration.binary_directories.extend(std::env::split_paths(&path)); }
    Ok(integration)
  }

  pub fn info(&self) -> KitInfo { serde_json::from_str(&self.files["kit.json"]).expect("valid built-in kit metadata") }

  fn root(&self, tool: &str) -> Result<PathBuf, String> {
    let default = match tool {
      "codex" => self.home.join(".agents/skills"),
      "claude" => self.claude_home.join("skills"),
      _ => return Err("Unsupported development tool".into()),
    };
    Ok(default)
  }

  fn detected(&self, tool: &str) -> bool {
    let binary = if tool == "codex" { "codex" } else { "claude" };
    (if tool == "codex" { self.codex_home.is_dir() || self.codex_app.is_dir() || self.home.join("Applications/Codex.app").is_dir() || self.codex_override.as_ref().is_some_and(|p| p.is_file()) } else { self.claude_home.is_dir() })
      || self.binary_directories.iter().any(|p| p.join(binary).is_file() || p.join(format!("{binary}.exe")).is_file() || p.join(format!("{binary}.cmd")).is_file())
  }

  pub fn inspect(&self, tool: &str) -> Result<IntegrationStatus, String> {
    let root = self.root(tool)?;
    let directory = root.join(SKILL_NAME);
    let kit = self.info();
    let mut result = IntegrationStatus { tool: tool.into(), detected: self.detected(tool), directory: directory.to_string_lossy().into(), status: "missing".into(), installed_version: None, bundled_version: kit.version.clone(), platform_version: kit.platform_version, changed_files: vec![], detail: None };
    let metadata = match fs::symlink_metadata(&directory) {
      Ok(value) => value,
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
        if fs::symlink_metadata(root.join(BACKUP)).is_ok() { result.status = "recovery".into(); }
        return Ok(result);
      },
      Err(e) => return Err(e.to_string()),
    };
    result.status = "modified".into();
    if metadata.file_type().is_symlink() || !metadata.is_dir() { result.detail = Some("Existing skill is not a regular directory; it was preserved".into()); return Ok(result); }
    let actual = match read_hashes(&directory) { Ok(files) => files, Err(e) => { result.detail = Some(e); return Ok(result); } };
    let receipt = fs::read(directory.join(RECEIPT)).ok().and_then(|bytes| serde_json::from_slice::<Receipt>(&bytes).ok());
    let Some(receipt) = receipt else { result.detail = Some("Existing skill has no Nooki installation record; it was preserved".into()); return Ok(result); };
    result.installed_version = Some(receipt.version.clone());
    result.changed_files = actual.keys().chain(receipt.files.keys()).filter(|key| actual.get(*key) != receipt.files.get(*key)).cloned().collect();
    result.changed_files.sort(); result.changed_files.dedup();
    if !result.changed_files.is_empty() { return Ok(result); }
    result.status = if actual == hashes(&self.files) { "current" }
      else if semver::Version::parse(&receipt.version).ok() > semver::Version::parse(&kit.version).ok() { "newer" }
      else { "update" }.into();
    Ok(result)
  }

  pub fn install(&self, tool: &str) -> Result<IntegrationStatus, String> {
    let _guard = self.gate.lock().map_err(|_| "Integration is busy")?;
    let root = self.root(tool)?;
    let destination = root.join(SKILL_NAME);
    let backup = root.join(BACKUP);
    let status = self.inspect(tool)?;
    if status.status == "current" { return Ok(status); }
    if status.status == "modified" || status.status == "newer" { return Err("Existing skill has local changes or a newer version. Download the kit to compare; your files were preserved.".into()); }
    if status.status == "recovery" {
      read_hashes(&backup)?;
      fs::rename(&backup, &destination).map_err(|e| format!("Could not restore previous skill: {e}"))?;
      return self.inspect(tool);
    }
    if fs::symlink_metadata(&backup).is_ok() { return Err(format!("A previous integration backup remains at {}. Preserve or move it before retrying.", backup.display())); }
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create skills directory: {e}"))?;
    let stage = root.join(format!(".workbench-capability-dev-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let operation = (|| {
      for (name, content) in &self.files {
        let path = Path::new(name);
        if path.components().any(|part| !matches!(part, std::path::Component::Normal(_))) { return Err("Invalid bundled resource path".into()); }
        let path = stage.join(path);
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
      }
      let receipt = Receipt { version: self.info().version, files: hashes(&self.files) };
      fs::write(stage.join(RECEIPT), serde_json::to_vec(&receipt).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
      // Recheck after staging: a user may edit the skill while the modal is open.
      let latest = self.inspect(tool)?;
      if latest.status != status.status || latest.installed_version != status.installed_version { return Err("Skill changed during integration; refresh and retry".into()); }
      let replacing = status.status == "update";
      if replacing { fs::rename(&destination, &backup).map_err(|e| e.to_string())?; }
      if let Err(error) = fs::rename(&stage, &destination) {
        if replacing { fs::rename(&backup, &destination).map_err(|restore| format!("Install failed: {error}; restore failed: {restore}. Previous skill remains at {}", backup.display()))?; }
        return Err(error.to_string());
      }
      if replacing { fs::remove_dir_all(&backup).map_err(|e| format!("Skill installed, but previous backup could not be removed: {e}"))?; }
      self.inspect(tool)
    })();
    if stage.is_dir() { let _ = fs::remove_dir_all(stage); }
    operation
  }

  pub fn export_archive(&self) -> Result<PathBuf, String> {
    let directory = self.home.join("Downloads");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(format!("workbench-capability-dev-{}-{}.zip", self.info().version, chrono::Utc::now().timestamp_millis()));
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, content) in &self.files {
      zip.start_file(format!("{SKILL_NAME}/{name}"), zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).map_err(|e| e.to_string())?;
      zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }
    let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(path)
  }
}

#[tauri::command]
pub fn developer_integrations(state: tauri::State<'_, DeveloperIntegration>) -> Result<Vec<IntegrationStatus>, String> {
  ["codex", "claude"].into_iter().map(|tool| state.inspect(tool)).collect()
}

#[tauri::command]
pub fn developer_integration_install(tool: String, state: tauri::State<'_, DeveloperIntegration>) -> Result<IntegrationStatus, String> {
  state.install(&tool)
}

#[tauri::command]
pub fn developer_kit_export(state: tauri::State<'_, DeveloperIntegration>) -> Result<String, String> {
  state.export_archive().map(|p| p.to_string_lossy().into_owned())
}
