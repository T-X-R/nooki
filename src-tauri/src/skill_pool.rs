// The Skill Pool keeps one copy of every skill in ~/.agents/skills and serves each detected coding
// tool a managed copy. Nooki only ever removes a directory it recorded in that tool's receipt.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fs, path::{Component, Path, PathBuf}, sync::Mutex};

pub const RECEIPT: &str = ".nooki-skill-mirror.json";
const SETTINGS: &str = "skill-pool.json";
const TRASH: &str = ".nooki-trash";
const SKILL_FILE: &str = "SKILL.md";
/// Long instructions are read in the pool, not in Nooki: enough to judge a skill, not a whole book.
const READING_LIMIT: usize = 200_000;
const IMAGE_LIMIT: u64 = 3_000_000;

type Hashes = BTreeMap<String, String>;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
  #[serde(default)] custom_tools: Vec<CustomTool>,
  /// Skills the person deselected, per tool id. Absent means every skill is distributed.
  #[serde(default)] excluded: BTreeMap<String, BTreeSet<String>>,
  /// Foreign directories the person chose to leave alone, per tool id.
  #[serde(default)] ignored: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTool { pub id: String, pub name: String, pub directory: String }

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt { #[serde(default)] skills: BTreeMap<String, Hashes> }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolSkill {
  pub name: String,
  pub title: String,
  pub description: String,
  pub file_count: usize,
  pub updated_at: String,
  pub issue: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry { pub name: String, pub state: String, pub description: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolView {
  pub id: String,
  pub name: String,
  pub directory: String,
  pub detected: bool,
  pub reads_pool: bool,
  pub custom: bool,
  pub selected: Vec<String>,
  pub entries: Vec<ToolEntry>,
  pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicate {
  pub kind: String,
  pub name: String,
  pub tool_id: String,
  pub tool_name: String,
  pub directory: String,
  pub description: String,
  pub pool_name: String,
  pub differing_files: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
  pub pool_directory: String,
  /// False until a skill is adopted or installed: scanning never creates the pool.
  pub pool_exists: bool,
  pub skills: Vec<PoolSkill>,
  pub tools: Vec<ToolView>,
  pub duplicates: Vec<Duplicate>,
  pub notices: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
  pub name: String,
  pub title: String,
  pub description: String,
  pub directory: String,
  pub files: Vec<String>,
  pub content: String,
  pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
  pub path: String,
  /// markdown, text, image, or binary: what the interface should do with `content`.
  pub kind: String,
  pub content: String,
  pub truncated: bool,
  pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removal { pub tool_id: String, pub tool_name: String, pub state: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport { pub name: String, pub trash: String, pub removed: Vec<Removal>, pub kept: Vec<Removal> }

struct Tool { id: String, name: String, directory: PathBuf, detected: bool, reads_pool: bool, custom: bool }

pub struct SkillPool { pool: PathBuf, data: PathBuf, agents: crate::agent_tools::AgentTools, gate: Mutex<()> }

fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn safe_name(name: &str) -> Result<(), String> {
  if name.is_empty() || name.starts_with('.') || name.len() > 96 { return Err("A skill name cannot be empty, hidden, or unusually long".into()); }
  if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') { return Err("A skill name may use letters, digits, dashes, dots and underscores".into()); }
  if Path::new(name).components().count() != 1 { return Err("A skill name cannot contain a path".into()); }
  Ok(())
}

/// Hash every file below a skill directory. A link anywhere inside makes the directory unmanageable.
fn hashes(directory: &Path) -> Result<Hashes, String> {
  fn visit(root: &Path, current: &Path, files: &mut Hashes) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
      let entry = entry.map_err(|e| e.to_string())?;
      let path = entry.path();
      let name = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
      let kind = entry.file_type().map_err(|e| e.to_string())?;
      if kind.is_symlink() { return Err(format!("Contains a link: {name}")); }
      if kind.is_dir() { visit(root, &path, files)?; }
      else if kind.is_file() { if name != RECEIPT { files.insert(name, digest(&fs::read(&path).map_err(|e| e.to_string())?)); } }
      else { return Err(format!("Contains an unsupported file: {name}")); }
    }
    Ok(())
  }
  let mut files = Hashes::new();
  visit(directory, directory, &mut files)?;
  Ok(files)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
  fs::create_dir_all(to).map_err(|e| e.to_string())?;
  for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let kind = entry.file_type().map_err(|e| e.to_string())?;
    let target = to.join(entry.file_name());
    if kind.is_symlink() { return Err("Cannot copy a linked file".into()); }
    if kind.is_dir() { copy_tree(&entry.path(), &target)?; }
    else if entry.file_name() != RECEIPT { fs::copy(entry.path(), &target).map_err(|e| e.to_string())?; }
  }
  Ok(())
}

/// Read `name` and `description` from the frontmatter a skill declares.
fn describe(directory: &Path) -> Option<(String, String)> {
  let content = fs::read_to_string(directory.join(SKILL_FILE)).ok()?;
  let body = content.strip_prefix("---\n").or_else(|| content.strip_prefix("---\r\n"))?;
  let end = body.find("\n---")?;
  let mut name = String::new();
  let mut description = String::new();
  for line in body[..end].lines() {
    let Some((key, value)) = line.split_once(':') else { continue };
    let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
    match key.trim() { "name" => name = value, "description" => description = value, _ => {} }
  }
  Some((name, description))
}

fn stamp() -> String { chrono::Local::now().format("%Y%m%d-%H%M%S").to_string() }

fn modified_at(directory: &Path) -> String {
  fs::metadata(directory.join(SKILL_FILE)).or_else(|_| fs::metadata(directory)).ok()
    .and_then(|data| data.modified().ok())
    .map(|time| chrono::DateTime::<chrono::Local>::from(time).to_rfc3339())
    .unwrap_or_default()
}

impl SkillPool {
  pub fn new(home: PathBuf, data: PathBuf) -> Self {
    Self { pool: home.join(".agents/skills"), data, agents: crate::agent_tools::AgentTools::new(home), gate: Mutex::new(()) }
  }

  pub fn from_environment(data: PathBuf) -> Result<Self, String> {
    let agents = crate::agent_tools::AgentTools::from_environment()?;
    Ok(Self { pool: agents.home.join(".agents/skills"), data, agents, gate: Mutex::new(()) })
  }

  pub fn directory(&self) -> &Path { &self.pool }

  /// Agent detection is shared with Settings: one probe, every surface that needs to know.
  pub fn agents(&self) -> &crate::agent_tools::AgentTools { &self.agents }

  /// The custom tools a person registered, as the shape `AgentTools::overview` expects.
  pub fn custom_tools(&self) -> Vec<(String, String, String)> {
    self.settings().custom_tools.into_iter().map(|tool| (tool.id, tool.name, tool.directory)).collect()
  }

  fn settings(&self) -> Settings {
    fs::read(self.data.join(SETTINGS)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
  }

  fn save(&self, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(&self.data).map_err(|e| e.to_string())?;
    let path = self.data.join(SETTINGS);
    let pending = path.with_extension("pending");
    fs::write(&pending, serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&pending, &path).map_err(|e| e.to_string())
  }

  fn tools(&self, settings: &Settings) -> Vec<Tool> {
    // pi reads ~/.agents/skills itself, so mirroring into its own directory would duplicate the pool.
    let mut tools: Vec<Tool> = self.agents.builtin(&self.pool).into_iter()
      .map(|tool| Tool { id: tool.id.into(), name: tool.name.into(), directory: tool.skills, detected: tool.detected, reads_pool: tool.reads_pool, custom: false })
      .collect();
    for custom in &settings.custom_tools {
      let directory = PathBuf::from(&custom.directory);
      let detected = directory.is_dir();
      let reads_pool = directory == self.pool;
      tools.push(Tool { id: custom.id.clone(), name: custom.name.clone(), directory, detected, reads_pool, custom: true });
    }
    tools
  }

  fn skills(&self) -> Result<Vec<PoolSkill>, String> {
    let mut skills = Vec::new();
    let Ok(entries) = fs::read_dir(&self.pool) else { return Ok(skills) };
    for entry in entries {
      let entry = entry.map_err(|e| e.to_string())?;
      let name = entry.file_name().to_string_lossy().into_owned();
      if name.starts_with('.') || !entry.file_type().map_err(|e| e.to_string())?.is_dir() { continue; }
      let path = entry.path();
      let described = describe(&path);
      let counted = hashes(&path);
      skills.push(PoolSkill {
        title: described.as_ref().map(|value| value.0.clone()).filter(|value| !value.is_empty()).unwrap_or_else(|| name.clone()),
        description: described.as_ref().map(|value| value.1.clone()).unwrap_or_default(),
        file_count: counted.as_ref().map(|files| files.len()).unwrap_or_default(),
        updated_at: modified_at(&path),
        issue: match (&described, &counted) {
          (None, _) => Some("No SKILL.md with frontmatter".into()),
          (_, Err(reason)) => Some(reason.clone()),
          _ => None,
        },
        name,
      });
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
  }

  fn receipt(&self, tool: &Tool) -> Receipt {
    fs::read(tool.directory.join(RECEIPT)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
  }

  fn write_receipt(&self, tool: &Tool, receipt: &Receipt) -> Result<(), String> {
    fs::create_dir_all(&tool.directory).map_err(|e| e.to_string())?;
    fs::write(tool.directory.join(RECEIPT), serde_json::to_vec_pretty(receipt).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
  }

  fn distributed(&self, settings: &Settings, tool: &Tool, skills: &[PoolSkill]) -> Vec<String> {
    let excluded = settings.excluded.get(&tool.id);
    skills.iter().map(|skill| skill.name.clone()).filter(|name| !excluded.is_some_and(|set| set.contains(name))).collect()
  }

  /// Replace a tool directory entry with a fresh copy of the pool skill, staged then moved.
  fn write_mirror(&self, tool: &Tool, name: &str) -> Result<Hashes, String> {
    let source = self.pool.join(name);
    let expected = hashes(&source)?;
    fs::create_dir_all(&tool.directory).map_err(|e| e.to_string())?;
    let stage = tool.directory.join(format!(".nooki-stage-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    let outcome = (|| {
      copy_tree(&source, &stage)?;
      if hashes(&stage)? != expected { return Err("The skill changed while it was being copied".into()); }
      let destination = tool.directory.join(name);
      if fs::symlink_metadata(&destination).is_ok() { remove_entry(&destination)?; }
      fs::rename(&stage, &destination).map_err(|e| e.to_string())?;
      Ok(expected)
    })();
    if fs::symlink_metadata(&stage).is_ok() { let _ = fs::remove_dir_all(&stage); }
    outcome
  }

  /// Bring one tool in line with the pool. Never touches an entry missing from the receipt.
  fn reconcile(&self, settings: &Settings, tool: &Tool, skills: &[PoolSkill], notices: &mut Vec<String>) -> (Vec<ToolEntry>, Vec<Duplicate>) {
    let mut entries = Vec::new();
    let mut duplicates = Vec::new();
    if tool.reads_pool || !tool.detected { return (entries, duplicates); }
    let mut receipt = self.receipt(tool);
    let wanted: Vec<String> = self.distributed(settings, tool, skills);
    let ignored = settings.ignored.get(&tool.id);
    let mut changed = false;

    for name in &wanted {
      let destination = tool.directory.join(name);
      let present = fs::symlink_metadata(&destination).ok();
      let recorded = receipt.skills.get(name).cloned();
      let pool_files = match hashes(&self.pool.join(name)) { Ok(files) => files, Err(reason) => { notices.push(format!("{name}: {reason}")); continue } };
      match present {
        None => match self.write_mirror(tool, name) {
          Ok(files) => { receipt.skills.insert(name.clone(), files); changed = true; entries.push(ToolEntry { name: name.clone(), state: "mirror".into(), description: String::new() }); },
          Err(reason) => notices.push(format!("{} · {name}: {reason}", tool.name)),
        },
        // A link the person set up by hand still works, but Nooki cannot manage or uninstall it.
        Some(meta) if meta.file_type().is_symlink() => {
          entries.push(ToolEntry { name: name.clone(), state: "linked".into(), description: String::new() });
          if !ignored.is_some_and(|set| set.contains(name)) {
            duplicates.push(Duplicate { kind: "linked".into(), name: name.clone(), tool_id: tool.id.clone(), tool_name: tool.name.clone(), directory: destination.to_string_lossy().into_owned(), description: String::new(), pool_name: name.clone(), differing_files: vec![] });
          }
        },
        Some(_) => {
          let actual = hashes(&destination);
          match (actual, recorded) {
            (Ok(actual), Some(recorded)) if actual == recorded => {
              if actual != pool_files {
                match self.write_mirror(tool, name) {
                  Ok(files) => { receipt.skills.insert(name.clone(), files); changed = true; },
                  Err(reason) => notices.push(format!("{} · {name}: {reason}", tool.name)),
                }
              }
              entries.push(ToolEntry { name: name.clone(), state: "mirror".into(), description: String::new() });
            },
            (Ok(actual), Some(_)) => {
              entries.push(ToolEntry { name: name.clone(), state: "modified".into(), description: String::new() });
              duplicates.push(self.duplicate("modified", name, name, tool, &actual, &pool_files));
            },
            (Ok(actual), None) => {
              entries.push(ToolEntry { name: name.clone(), state: "foreign".into(), description: describe(&destination).map(|value| value.1).unwrap_or_default() });
              if !ignored.is_some_and(|set| set.contains(name)) { duplicates.push(self.duplicate("name", name, name, tool, &actual, &pool_files)); }
            },
            (Err(reason), _) => { entries.push(ToolEntry { name: name.clone(), state: "unreadable".into(), description: reason }); },
          }
        },
      }
    }

    // Uninstall what the person deselected or deleted, but only copies Nooki itself wrote.
    let stale: Vec<String> = receipt.skills.keys().filter(|name| !wanted.contains(name)).cloned().collect();
    for name in stale {
      let destination = tool.directory.join(&name);
      match fs::symlink_metadata(&destination) {
        Err(_) => { receipt.skills.remove(&name); changed = true; },
        Ok(_) => match hashes(&destination) {
          Ok(actual) if Some(&actual) == receipt.skills.get(&name) => {
            match remove_entry(&destination) {
              Ok(()) => { receipt.skills.remove(&name); changed = true; },
              Err(reason) => notices.push(format!("{} · {name}: {reason}", tool.name)),
            }
          },
          _ => entries.push(ToolEntry { name: name.clone(), state: "modified".into(), description: String::new() }),
        },
      }
    }

    // Anything else in the directory belongs to the person: offer adoption, never touch it.
    if let Ok(listing) = fs::read_dir(&tool.directory) {
      for entry in listing.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || wanted.contains(&name) || receipt.skills.contains_key(&name) { continue; }
        let path = entry.path();
        let linked = entry.file_type().map(|kind| kind.is_symlink()).unwrap_or(false);
        if !linked && !path.is_dir() { continue; }
        let described = describe(&path);
        if described.is_none() && !linked { continue; }
        entries.push(ToolEntry { name: name.clone(), state: if linked { "linked".into() } else { "foreign".into() }, description: described.map(|value| value.1).unwrap_or_default() });
        if !linked && !ignored.is_some_and(|set| set.contains(&name)) {
          duplicates.push(Duplicate { kind: "adopt".into(), name: name.clone(), tool_id: tool.id.clone(), tool_name: tool.name.clone(), directory: path.to_string_lossy().into_owned(), description: describe(&path).map(|value| value.1).unwrap_or_default(), pool_name: String::new(), differing_files: vec![] });
        }
      }
    }

    if changed { if let Err(reason) = self.write_receipt(tool, &receipt) { notices.push(format!("{}: {reason}", tool.name)); } }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    (entries, duplicates)
  }

  fn duplicate(&self, kind: &str, name: &str, pool_name: &str, tool: &Tool, actual: &Hashes, pool_files: &Hashes) -> Duplicate {
    let mut differing: Vec<String> = actual.keys().chain(pool_files.keys()).filter(|key| actual.get(*key) != pool_files.get(*key)).cloned().collect();
    differing.sort(); differing.dedup();
    Duplicate {
      kind: kind.into(), name: name.into(), tool_id: tool.id.clone(), tool_name: tool.name.clone(),
      directory: tool.directory.join(name).to_string_lossy().into_owned(),
      description: describe(&tool.directory.join(name)).map(|value| value.1).unwrap_or_default(),
      pool_name: pool_name.into(), differing_files: differing,
    }
  }

  /// Scan, sync every detected tool, and report what needs a decision.
  pub fn overview(&self) -> Result<Overview, String> {
    let _guard = self.gate.lock().map_err(|_| "The skill pool is busy")?;
    let settings = self.settings();
    let skills = self.skills()?;
    let mut notices = Vec::new();
    let mut duplicates = Vec::new();
    let mut views = Vec::new();
    for tool in self.tools(&settings) {
      let (entries, mut conflicts) = self.reconcile(&settings, &tool, &skills, &mut notices);
      duplicates.append(&mut conflicts);
      views.push(ToolView {
        selected: if tool.reads_pool { skills.iter().map(|skill| skill.name.clone()).collect() } else { self.distributed(&settings, &tool, &skills) },
        id: tool.id, name: tool.name, directory: tool.directory.to_string_lossy().into_owned(),
        detected: tool.detected, reads_pool: tool.reads_pool, custom: tool.custom, entries, error: None,
      });
    }
    // Two pool skills holding identical content are the same skill under two names.
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for skill in &skills {
      let Ok(files) = hashes(&self.pool.join(&skill.name)) else { continue };
      let signature = digest(serde_json::to_string(&files).unwrap_or_default().as_bytes());
      if let Some(first) = seen.get(&signature) {
        duplicates.push(Duplicate { kind: "content".into(), name: skill.name.clone(), tool_id: String::new(), tool_name: String::new(), directory: self.pool.join(&skill.name).to_string_lossy().into_owned(), description: skill.description.clone(), pool_name: first.clone(), differing_files: vec![] });
      } else { seen.insert(signature, skill.name.clone()); }
    }
    Ok(Overview { pool_directory: self.pool.to_string_lossy().into_owned(), pool_exists: self.pool.is_dir(), skills, tools: views, duplicates, notices })
  }

  pub fn set_selection(&self, tool_id: &str, selected: Vec<String>) -> Result<(), String> {
    let mut settings = self.settings();
    let skills = self.skills()?;
    let excluded: BTreeSet<String> = skills.iter().map(|skill| skill.name.clone()).filter(|name| !selected.contains(name)).collect();
    let tools = self.tools(&settings);
    let tool = tools.iter().find(|tool| tool.id == tool_id).ok_or("Unknown coding tool")?;
    if tool.reads_pool { return Err("This tool reads the skill pool directly, so every skill is available to it".into()); }
    if excluded.is_empty() { settings.excluded.remove(tool_id); } else { settings.excluded.insert(tool_id.into(), excluded); }
    self.save(&settings)
  }

  /// Resolve one directory a tool holds: adopt it, keep the pool copy, replace the pool copy,
  /// adopt under a new name, or leave it alone.
  pub fn resolve(&self, tool_id: &str, name: &str, action: &str, rename: Option<String>) -> Result<(), String> {
    let _guard = self.gate.lock().map_err(|_| "The skill pool is busy")?;
    safe_name(name)?;
    let mut settings = self.settings();
    let tools = self.tools(&settings);
    let tool = tools.iter().find(|tool| tool.id == tool_id).ok_or("Unknown coding tool")?;
    if tool.reads_pool { return Err("This tool reads the skill pool directly".into()); }
    let source = tool.directory.join(name);
    if action != "keep-pool" && hashes(&source).is_err() { return Err("This directory cannot be managed: it contains links or unsupported files".into()); }
    match action {
      "ignore" => { settings.ignored.entry(tool_id.into()).or_default().insert(name.into()); self.save(&settings) },
      "keep-pool" => {
        if !self.pool.join(name).is_dir() { return Err("The pool has no skill with this name".into()); }
        self.write_mirror(tool, name)?;
        let mut receipt = self.receipt(tool);
        receipt.skills.insert(name.into(), hashes(&self.pool.join(name))?);
        self.write_receipt(tool, &receipt)
      },
      "adopt" | "replace-pool" | "rename" => {
        let target = match action { "rename" => rename.ok_or("A new name is required")?, _ => name.to_string() };
        safe_name(&target)?;
        let destination = self.pool.join(&target);
        if action == "adopt" && destination.is_dir() { return Err("The pool already holds a skill with this name".into()); }
        fs::create_dir_all(&self.pool).map_err(|e| e.to_string())?;
        let stage = self.pool.join(format!(".nooki-adopt-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
        let expected = hashes(&source)?;
        let outcome = (|| {
          copy_tree(&source, &stage)?;
          if hashes(&stage)? != expected { return Err("The skill changed while it was being adopted".into()); }
          if destination.is_dir() { self.trash(&target)?; }
          fs::rename(&stage, &destination).map_err(|e| e.to_string())
        })();
        if fs::symlink_metadata(&stage).is_ok() { let _ = fs::remove_dir_all(&stage); }
        outcome?;
        // The tool now gets a managed copy in place of the directory it held.
        if target != name { remove_entry(&source)?; }
        let files = self.write_mirror(tool, &target)?;
        let mut receipt = self.receipt(tool);
        if target != name { receipt.skills.remove(name); }
        receipt.skills.insert(target.clone(), files);
        self.write_receipt(tool, &receipt)?;
        settings.ignored.get_mut(tool_id).map(|set| set.remove(name));
        self.save(&settings)
      },
      _ => Err("Unsupported resolution".into()),
    }
  }

  fn trash(&self, name: &str) -> Result<PathBuf, String> {
    let trash = self.pool.parent().unwrap_or(&self.pool).join(TRASH);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamped = trash.join(format!("{name}-{}", stamp()));
    let mut target = stamped.clone();
    let mut attempt = 1;
    while fs::symlink_metadata(&target).is_ok() { target = PathBuf::from(format!("{}-{attempt}", stamped.display())); attempt += 1; }
    fs::rename(self.pool.join(name), &target).map_err(|e| format!("Could not move the skill to trash: {e}"))?;
    Ok(target)
  }

  /// Uninstall a skill from every tool that holds it, then move the pool copy to trash.
  pub fn delete(&self, name: &str, include_modified: bool) -> Result<DeleteReport, String> {
    let _guard = self.gate.lock().map_err(|_| "The skill pool is busy")?;
    safe_name(name)?;
    if !self.pool.join(name).is_dir() { return Err("The pool has no skill with this name".into()); }
    let mut settings = self.settings();
    let mut removed = Vec::new();
    let mut kept = Vec::new();
    for tool in self.tools(&settings) {
      if tool.reads_pool { if tool.detected { removed.push(Removal { tool_id: tool.id.clone(), tool_name: tool.name.clone(), state: "pool".into() }); } continue; }
      let mut receipt = self.receipt(&tool);
      let destination = tool.directory.join(name);
      if fs::symlink_metadata(&destination).is_err() { if receipt.skills.remove(name).is_some() { self.write_receipt(&tool, &receipt)?; } continue; }
      let recorded = receipt.skills.get(name).cloned();
      let actual = hashes(&destination).ok();
      let managed = recorded.is_some() && recorded == actual;
      if !managed && !include_modified {
        kept.push(Removal { tool_id: tool.id.clone(), tool_name: tool.name.clone(), state: if recorded.is_some() { "modified".into() } else { "foreign".into() } });
        continue;
      }
      if !managed && recorded.is_none() { kept.push(Removal { tool_id: tool.id.clone(), tool_name: tool.name.clone(), state: "foreign".into() }); continue; }
      remove_entry(&destination)?;
      receipt.skills.remove(name);
      self.write_receipt(&tool, &receipt)?;
      removed.push(Removal { tool_id: tool.id.clone(), tool_name: tool.name.clone(), state: "uninstalled".into() });
    }
    let trash = self.trash(name)?;
    for set in settings.excluded.values_mut() { set.remove(name); }
    for set in settings.ignored.values_mut() { set.remove(name); }
    self.save(&settings)?;
    Ok(DeleteReport { name: name.into(), trash: trash.to_string_lossy().into_owned(), removed, kept })
  }

  pub fn add_tool(&self, name: String, directory: String) -> Result<CustomTool, String> {
    let mut settings = self.settings();
    let name = name.trim().to_string();
    if name.is_empty() { return Err("Name the coding tool".into()); }
    let path = PathBuf::from(shell_expand(&directory, &self.agents.home));
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) { return Err("Give the tool's skills directory as an absolute path".into()); }
    if !path.is_dir() { return Err("That directory does not exist".into()); }
    let tools = self.tools(&settings);
    if tools.iter().any(|tool| tool.directory == path) { return Err("That directory is already managed".into()); }
    let id = format!("custom-{}", &digest(path.to_string_lossy().as_bytes())[..8]);
    let tool = CustomTool { id, name, directory: path.to_string_lossy().into_owned() };
    settings.custom_tools.push(tool.clone());
    self.save(&settings)?;
    Ok(tool)
  }

  /// Forget a custom tool and uninstall the mirrors Nooki put there.
  pub fn remove_tool(&self, tool_id: &str) -> Result<(), String> {
    let mut settings = self.settings();
    let tools = self.tools(&settings);
    let tool = tools.iter().find(|tool| tool.id == tool_id).ok_or("Unknown coding tool")?;
    if !tool.custom { return Err("Built-in tools cannot be removed".into()); }
    let mut receipt = self.receipt(tool);
    let names: Vec<String> = receipt.skills.keys().cloned().collect();
    for name in names {
      let destination = tool.directory.join(&name);
      if fs::symlink_metadata(&destination).is_ok() && hashes(&destination).ok().as_ref() == receipt.skills.get(&name) { remove_entry(&destination)?; }
      receipt.skills.remove(&name);
    }
    let _ = fs::remove_file(tool.directory.join(RECEIPT));
    settings.custom_tools.retain(|custom| custom.id != tool_id);
    settings.excluded.remove(tool_id);
    settings.ignored.remove(tool_id);
    self.save(&settings)
  }

  /// Put a skill Nooki ships into the pool, replacing an earlier copy Nooki wrote.
  pub fn install_bundled(&self, name: &str, files: &BTreeMap<String, String>) -> Result<(), String> {
    let _guard = self.gate.lock().map_err(|_| "The skill pool is busy")?;
    safe_name(name)?;
    fs::create_dir_all(&self.pool).map_err(|e| e.to_string())?;
    let destination = self.pool.join(name);
    let stage = self.pool.join(format!(".nooki-install-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    let outcome = (|| {
      for (path, content) in files {
        let relative = Path::new(path);
        if relative.components().any(|part| !matches!(part, Component::Normal(_))) { return Err("Invalid bundled resource path".into()); }
        let target = stage.join(relative);
        fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(target, content).map_err(|e| e.to_string())?;
      }
      if fs::symlink_metadata(&destination).is_ok() { remove_entry(&destination)?; }
      fs::rename(&stage, &destination).map_err(|e| e.to_string())
    })();
    if fs::symlink_metadata(&stage).is_ok() { let _ = fs::remove_dir_all(&stage); }
    outcome
  }

  pub fn skill_hashes(&self, name: &str) -> Result<Hashes, String> { hashes(&self.pool.join(name)) }

  /// Read one pool skill for display. Instructions are shown, never executed.
  pub fn read(&self, name: &str) -> Result<SkillDetail, String> {
    safe_name(name)?;
    let directory = self.pool.join(name);
    if !directory.is_dir() { return Err("The pool has no skill with this name".into()); }
    let files: Vec<String> = hashes(&directory)?.into_keys().collect();
    let described = describe(&directory);
    let raw = fs::read_to_string(directory.join(SKILL_FILE)).unwrap_or_default();
    let truncated = raw.len() > READING_LIMIT;
    Ok(SkillDetail {
      name: name.into(),
      title: described.as_ref().map(|value| value.0.clone()).filter(|value| !value.is_empty()).unwrap_or_else(|| name.into()),
      description: described.map(|value| value.1).unwrap_or_default(),
      directory: directory.to_string_lossy().into_owned(),
      content: if truncated { raw.chars().take(READING_LIMIT).collect() } else { raw },
      files, truncated,
    })
  }

  /// Read one file inside a pool skill so its references, scripts and images can be inspected.
  pub fn read_file(&self, name: &str, path: &str) -> Result<SkillFile, String> {
    safe_name(name)?;
    let relative = Path::new(path);
    if relative.components().any(|part| !matches!(part, Component::Normal(_))) { return Err("That file is outside the skill".into()); }
    let target = self.pool.join(name).join(relative);
    let metadata = fs::symlink_metadata(&target).map_err(|_| "That file is no longer there".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() { return Err("Only a regular file inside the skill can be read".into()); }
    let size_bytes = metadata.len();
    let extension = target.extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
    let mut file = SkillFile { path: path.into(), kind: "binary".into(), content: String::new(), truncated: false, size_bytes };
    if let Some(media) = media_type(&extension) {
      if size_bytes <= IMAGE_LIMIT {
        file.kind = "image".into();
        file.content = format!("data:{media};base64,{}", base64(&fs::read(&target).map_err(|e| e.to_string())?));
      }
      return Ok(file);
    }
    let Ok(text) = fs::read_to_string(&target) else { return Ok(file) };
    file.kind = if extension == "md" || extension == "markdown" { "markdown".into() } else { "text".into() };
    file.truncated = text.len() > READING_LIMIT;
    file.content = if file.truncated { text.chars().take(READING_LIMIT).collect() } else { text };
    Ok(file)
  }
}

/// Data URLs keep image previews inside the interface without exposing the filesystem to it.
fn base64(bytes: &[u8]) -> String {
  const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let block = chunk.iter().enumerate().fold(0u32, |value, (index, byte)| value | (u32::from(*byte) << (16 - index * 8)));
    for index in 0..4 {
      if index <= chunk.len() { encoded.push(ALPHABET[(block >> (18 - index * 6) & 0x3f) as usize] as char); } else { encoded.push('='); }
    }
  }
  encoded
}

fn media_type(extension: &str) -> Option<&'static str> {
  Some(match extension {
    "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif",
    "webp" => "image/webp", "svg" => "image/svg+xml", "bmp" => "image/bmp", "avif" => "image/avif",
    _ => return None,
  })
}

fn shell_expand(path: &str, home: &Path) -> String {
  let trimmed = path.trim();
  match trimmed.strip_prefix("~/") { Some(rest) => home.join(rest).to_string_lossy().into_owned(), None => trimmed.to_string() }
}

fn remove_entry(path: &Path) -> Result<(), String> {
  let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
  if meta.file_type().is_symlink() || meta.is_file() { fs::remove_file(path).map_err(|e| e.to_string()) }
  else { fs::remove_dir_all(path).map_err(|e| e.to_string()) }
}

#[tauri::command]
pub fn skill_pool_overview(state: tauri::State<'_, SkillPool>) -> Result<Overview, String> { state.overview() }

#[tauri::command]
pub fn skill_pool_set_selection(tool: String, skills: Vec<String>, state: tauri::State<'_, SkillPool>) -> Result<Overview, String> {
  state.set_selection(&tool, skills)?;
  state.overview()
}

#[tauri::command]
pub fn skill_pool_resolve(tool: String, name: String, action: String, rename: Option<String>, state: tauri::State<'_, SkillPool>) -> Result<Overview, String> {
  state.resolve(&tool, &name, &action, rename)?;
  state.overview()
}

#[tauri::command]
pub fn skill_pool_read(name: String, state: tauri::State<'_, SkillPool>) -> Result<SkillDetail, String> { state.read(&name) }

#[tauri::command]
pub fn skill_pool_read_file(name: String, path: String, state: tauri::State<'_, SkillPool>) -> Result<SkillFile, String> { state.read_file(&name, &path) }

#[tauri::command]
pub fn skill_pool_delete(name: String, include_modified: bool, state: tauri::State<'_, SkillPool>) -> Result<DeleteReport, String> {
  state.delete(&name, include_modified)
}

#[tauri::command]
pub fn skill_pool_add_tool(name: String, directory: String, state: tauri::State<'_, SkillPool>) -> Result<Overview, String> {
  state.add_tool(name, directory)?;
  state.overview()
}

#[tauri::command]
pub fn skill_pool_remove_tool(tool: String, state: tauri::State<'_, SkillPool>) -> Result<Overview, String> {
  state.remove_tool(&tool)?;
  state.overview()
}
