use app_lib::skill_pool::{SkillPool, RECEIPT};
use std::{collections::BTreeMap, fs, path::PathBuf};

struct Fixture(PathBuf);

impl Fixture {
  fn new() -> Self {
    let root = std::env::temp_dir().join(format!("nooki-skill-pool-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
    fs::create_dir_all(&root).unwrap();
    Self(root)
  }
  fn pool(&self) -> SkillPool { SkillPool::new(self.0.clone(), self.0.join("data")) }
  fn home(&self, relative: &str) -> PathBuf { self.0.join(relative) }
  fn skill(&self, directory: &str, name: &str, body: &str) -> PathBuf {
    let path = self.0.join(directory).join(name);
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join("SKILL.md"), format!("---\nname: {name}\ndescription: {body}\n---\n\n# {name}\n")).unwrap();
    path
  }
  fn install_codex(&self) { fs::create_dir_all(self.0.join(".codex")).unwrap(); }
  fn install_claude(&self) { fs::create_dir_all(self.0.join(".claude")).unwrap(); }
}

impl Drop for Fixture {
  fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

fn tool<'a>(overview: &'a app_lib::skill_pool::Overview, id: &str) -> &'a app_lib::skill_pool::ToolView {
  overview.tools.iter().find(|tool| tool.id == id).expect("tool is listed")
}

#[test]
fn lists_only_the_coding_tools_installed_on_this_machine() {
  let fixture = Fixture::new();
  fixture.install_codex();
  let overview = fixture.pool().overview().unwrap();
  assert!(tool(&overview, "codex").detected);
  assert!(!tool(&overview, "claude").detected);
  assert!(!tool(&overview, "pi").detected);
  assert!(!fixture.home(".claude").exists(), "an absent tool is never created");
}

#[test]
fn distributes_every_pool_skill_to_a_detected_tool_by_default() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  let overview = fixture.pool().overview().unwrap();
  assert_eq!(overview.skills.iter().map(|skill| skill.name.as_str()).collect::<Vec<_>>(), ["pdf"]);
  assert_eq!(overview.skills[0].description, "Reads PDF files");
  assert_eq!(tool(&overview, "codex").selected, ["pdf"]);
  assert_eq!(fs::read_to_string(fixture.home(".codex/skills/pdf/SKILL.md")).unwrap(), fs::read_to_string(fixture.home(".agents/skills/pdf/SKILL.md")).unwrap());
  assert!(fixture.home(".codex/skills").join(RECEIPT).is_file());
}

#[test]
fn a_tool_that_reads_the_pool_directly_is_never_mirrored() {
  let fixture = Fixture::new();
  fs::create_dir_all(fixture.home(".pi")).unwrap();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  let overview = fixture.pool().overview().unwrap();
  let pi = tool(&overview, "pi");
  assert!(pi.reads_pool && pi.detected);
  assert_eq!(pi.selected, ["pdf"]);
  assert!(!fixture.home(".pi/agent/skills").exists());
}

#[test]
fn a_skill_dropped_into_the_pool_reaches_every_tool_on_the_next_scan() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.install_claude();
  let pool = fixture.pool();
  pool.overview().unwrap();
  fixture.skill(".agents/skills", "github-installed", "Installed by an agent");
  pool.overview().unwrap();
  for directory in [".codex/skills", ".claude/skills"] {
    assert!(fixture.home(directory).join("github-installed/SKILL.md").is_file(), "{directory} received the skill");
  }
}

#[test]
fn refreshes_a_mirror_when_the_pool_copy_changes_and_leaves_edited_mirrors_alone() {
  let fixture = Fixture::new();
  fixture.install_codex();
  let pool = fixture.pool();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  fixture.skill(".agents/skills", "diary", "Writes a diary");
  pool.overview().unwrap();
  fs::write(fixture.home(".agents/skills/pdf/SKILL.md"), "---\nname: pdf\ndescription: Reads and writes PDF files\n---\n").unwrap();
  fs::write(fixture.home(".codex/skills/diary/SKILL.md"), "---\nname: diary\ndescription: My own edit\n---\n").unwrap();
  let overview = pool.overview().unwrap();
  assert!(fs::read_to_string(fixture.home(".codex/skills/pdf/SKILL.md")).unwrap().contains("Reads and writes"));
  assert!(fs::read_to_string(fixture.home(".codex/skills/diary/SKILL.md")).unwrap().contains("My own edit"), "an edited mirror is preserved");
  let entry = tool(&overview, "codex").entries.iter().find(|entry| entry.name == "diary").unwrap();
  assert_eq!(entry.state, "modified");
  assert!(overview.duplicates.iter().any(|duplicate| duplicate.name == "diary" && duplicate.kind == "modified"));
}

#[test]
fn deselecting_a_skill_uninstalls_it_from_that_tool_only() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.install_claude();
  let pool = fixture.pool();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  fixture.skill(".agents/skills", "diary", "Writes a diary");
  pool.overview().unwrap();
  pool.set_selection("codex", vec!["pdf".into()]).unwrap();
  let overview = pool.overview().unwrap();
  assert!(!fixture.home(".codex/skills/diary").exists());
  assert!(fixture.home(".claude/skills/diary/SKILL.md").is_file());
  assert!(fixture.home(".agents/skills/diary/SKILL.md").is_file());
  assert_eq!(tool(&overview, "codex").selected, ["pdf"]);
}

#[test]
fn an_unknown_directory_is_offered_for_adoption_and_never_touched() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.skill(".codex/skills", "handmade", "Written by hand");
  fs::create_dir_all(fixture.home(".codex/skills/.system")).unwrap();
  fs::write(fixture.home(".codex/skills/.system/notes.md"), "tool internals").unwrap();
  let pool = fixture.pool();
  let overview = pool.overview().unwrap();
  assert!(fixture.home(".codex/skills/handmade/SKILL.md").is_file());
  assert!(overview.skills.is_empty(), "adoption waits for a decision");
  let duplicate = overview.duplicates.iter().find(|duplicate| duplicate.name == "handmade").unwrap();
  assert_eq!(duplicate.kind, "adopt");
  assert_eq!(duplicate.description, "Written by hand");
  assert_eq!(fs::read_to_string(fixture.home(".codex/skills/.system/notes.md")).unwrap(), "tool internals", "tool internals are left alone");

  pool.resolve("codex", "handmade", "adopt", None).unwrap();
  let overview = pool.overview().unwrap();
  assert_eq!(overview.skills.iter().map(|skill| skill.name.as_str()).collect::<Vec<_>>(), ["handmade"]);
  assert!(fixture.home(".agents/skills/handmade/SKILL.md").is_file());
  assert!(fixture.home(".codex/skills/handmade/SKILL.md").is_file(), "the tool keeps a managed copy");
  assert!(overview.duplicates.is_empty(), "{:?}", overview.duplicates);
}

#[test]
fn a_name_conflict_waits_for_a_choice_and_honours_it() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.install_claude();
  fixture.skill(".agents/skills", "pdf", "Pool version");
  fixture.skill(".claude/skills", "pdf", "Tool version");
  let pool = fixture.pool();
  let overview = pool.overview().unwrap();
  let conflict = overview.duplicates.iter().find(|duplicate| duplicate.kind == "name").unwrap();
  assert_eq!((conflict.name.as_str(), conflict.tool_id.as_str()), ("pdf", "claude"));
  assert_eq!(conflict.differing_files, ["SKILL.md"]);
  assert!(fs::read_to_string(fixture.home(".claude/skills/pdf/SKILL.md")).unwrap().contains("Tool version"), "nothing is overwritten before the choice");

  pool.resolve("claude", "pdf", "replace-pool", None).unwrap();
  let overview = pool.overview().unwrap();
  assert!(fs::read_to_string(fixture.home(".agents/skills/pdf/SKILL.md")).unwrap().contains("Tool version"));
  assert!(fs::read_to_string(fixture.home(".codex/skills/pdf/SKILL.md")).unwrap().contains("Tool version"), "the choice reaches every tool");
  assert!(overview.duplicates.is_empty(), "{:?}", overview.duplicates);
}

#[test]
fn a_name_conflict_can_keep_both_under_a_new_name() {
  let fixture = Fixture::new();
  fixture.install_claude();
  fixture.skill(".agents/skills", "pdf", "Pool version");
  fixture.skill(".claude/skills", "pdf", "Tool version");
  let pool = fixture.pool();
  pool.overview().unwrap();
  pool.resolve("claude", "pdf", "rename", Some("pdf-claude".into())).unwrap();
  let overview = pool.overview().unwrap();
  assert_eq!(overview.skills.iter().map(|skill| skill.name.as_str()).collect::<Vec<_>>(), ["pdf", "pdf-claude"]);
  assert!(fs::read_to_string(fixture.home(".agents/skills/pdf/SKILL.md")).unwrap().contains("Pool version"));
  assert!(fs::read_to_string(fixture.home(".claude/skills/pdf/SKILL.md")).unwrap().contains("Pool version"));
  assert!(fs::read_to_string(fixture.home(".claude/skills/pdf-claude/SKILL.md")).unwrap().contains("Tool version"));
}

#[test]
fn reports_two_pool_skills_that_hold_the_same_content() {
  let fixture = Fixture::new();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  let copy = fixture.home(".agents/skills/pdf-copy");
  fs::create_dir_all(&copy).unwrap();
  fs::copy(fixture.home(".agents/skills/pdf/SKILL.md"), copy.join("SKILL.md")).unwrap();
  let overview = fixture.pool().overview().unwrap();
  let duplicate = overview.duplicates.iter().find(|duplicate| duplicate.kind == "content").unwrap();
  assert_eq!((duplicate.pool_name.as_str(), duplicate.name.as_str()), ("pdf", "pdf-copy"));
}

#[test]
fn deleting_uninstalls_from_every_tool_and_keeps_the_pool_copy_in_trash() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.install_claude();
  fs::create_dir_all(fixture.home(".pi")).unwrap();
  let pool = fixture.pool();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  pool.overview().unwrap();
  let report = pool.delete("pdf", false).unwrap();
  assert_eq!(report.removed.iter().map(|removal| removal.tool_id.as_str()).collect::<Vec<_>>(), ["codex", "claude", "pi"]);
  assert!(!fixture.home(".codex/skills/pdf").exists());
  assert!(!fixture.home(".claude/skills/pdf").exists());
  assert!(!fixture.home(".agents/skills/pdf").exists());
  assert!(PathBuf::from(&report.trash).join("SKILL.md").is_file(), "the pool copy is recoverable");
  let receipt: serde_json::Value = serde_json::from_slice(&fs::read(fixture.home(".codex/skills").join(RECEIPT)).unwrap()).unwrap();
  assert!(receipt["skills"].get("pdf").is_none(), "the tool registration is removed too");
}

#[test]
fn deleting_keeps_an_edited_mirror_until_it_is_confirmed() {
  let fixture = Fixture::new();
  fixture.install_codex();
  let pool = fixture.pool();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  pool.overview().unwrap();
  fs::write(fixture.home(".codex/skills/pdf/SKILL.md"), "---\nname: pdf\ndescription: My own edit\n---\n").unwrap();
  let report = pool.delete("pdf", false).unwrap();
  assert_eq!(report.kept.iter().map(|removal| removal.state.as_str()).collect::<Vec<_>>(), ["modified"]);
  assert!(fixture.home(".codex/skills/pdf/SKILL.md").is_file());

  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  let report = pool.delete("pdf", true).unwrap();
  assert_eq!(report.removed.len(), 1);
  assert!(!fixture.home(".codex/skills/pdf").exists());
}

#[test]
fn a_custom_tool_receives_the_pool_and_gives_it_back_when_removed() {
  let fixture = Fixture::new();
  let directory = fixture.home("Library/xxa/skills");
  fs::create_dir_all(&directory).unwrap();
  let pool = fixture.pool();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  let added = pool.add_tool("xxa".into(), directory.to_string_lossy().into_owned()).unwrap();
  let overview = pool.overview().unwrap();
  let view = tool(&overview, &added.id);
  assert!(view.custom && view.detected);
  assert!(directory.join("pdf/SKILL.md").is_file());
  pool.remove_tool(&added.id).unwrap();
  assert!(!directory.join("pdf").exists());
  assert!(!directory.join(RECEIPT).exists());
  assert!(fixture.home(".agents/skills/pdf/SKILL.md").is_file());
  assert!(pool.overview().unwrap().tools.iter().all(|tool| !tool.custom));
}

#[test]
fn a_bundled_skill_enters_the_pool_once_and_is_distributed_from_there() {
  let fixture = Fixture::new();
  fixture.install_codex();
  fixture.install_claude();
  let pool = fixture.pool();
  let files = BTreeMap::from([("SKILL.md".to_string(), "---\nname: workbench-capability-dev\ndescription: Builds capabilities\n---\n".to_string()), ("references/contract.md".to_string(), "contract".to_string())]);
  pool.install_bundled("workbench-capability-dev", &files).unwrap();
  let overview = pool.overview().unwrap();
  assert!(overview.skills.iter().any(|skill| skill.name == "workbench-capability-dev"));
  for directory in [".codex/skills", ".claude/skills"] {
    assert_eq!(fs::read_to_string(fixture.home(directory).join("workbench-capability-dev/references/contract.md")).unwrap(), "contract");
  }
  assert_eq!(pool.skill_hashes("workbench-capability-dev").unwrap().len(), 2);
}

#[test]
fn refuses_a_skill_name_that_escapes_the_pool() {
  let fixture = Fixture::new();
  let pool = fixture.pool();
  assert!(pool.delete("../escape", false).is_err());
  assert!(pool.install_bundled(".hidden", &BTreeMap::new()).is_err());
  assert!(pool.resolve("codex", "pdf", "rename", Some("../escape".into())).is_err());
}

#[cfg(unix)]
#[test]
fn a_hand_made_link_is_reported_and_converted_into_a_managed_copy_only_on_request() {
  use std::os::unix::fs::symlink;
  let fixture = Fixture::new();
  fixture.install_claude();
  fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  fs::create_dir_all(fixture.home(".claude/skills")).unwrap();
  symlink(fixture.home(".agents/skills/pdf"), fixture.home(".claude/skills/pdf")).unwrap();
  let pool = fixture.pool();
  let overview = pool.overview().unwrap();
  assert!(fs::symlink_metadata(fixture.home(".claude/skills/pdf")).unwrap().file_type().is_symlink(), "a link the person made is left in place");
  let duplicate = overview.duplicates.iter().find(|duplicate| duplicate.kind == "linked").unwrap();
  assert_eq!((duplicate.name.as_str(), duplicate.tool_id.as_str()), ("pdf", "claude"));

  pool.resolve("claude", "pdf", "keep-pool", None).unwrap();
  let overview = pool.overview().unwrap();
  assert!(!fs::symlink_metadata(fixture.home(".claude/skills/pdf")).unwrap().file_type().is_symlink());
  assert!(fs::read_to_string(fixture.home(".claude/skills/pdf/SKILL.md")).unwrap().contains("Reads PDF files"));
  assert!(fixture.home(".agents/skills/pdf/SKILL.md").is_file(), "the pool keeps the original");
  assert!(overview.duplicates.is_empty(), "{:?}", overview.duplicates);
}

#[test]
fn a_machine_without_a_pool_keeps_its_skills_until_the_first_one_is_adopted() {
  let fixture = Fixture::new();
  fixture.install_claude();
  fixture.skill(".claude/skills", "handmade", "Written by hand");
  let pool = fixture.pool();
  let overview = pool.overview().unwrap();
  assert!(!overview.pool_exists);
  assert!(!fixture.home(".agents").exists(), "scanning never creates the pool");
  assert!(overview.skills.is_empty());
  assert_eq!(overview.duplicates.iter().map(|duplicate| duplicate.kind.as_str()).collect::<Vec<_>>(), ["adopt"]);
  assert!(fs::read_to_string(fixture.home(".claude/skills/handmade/SKILL.md")).unwrap().contains("Written by hand"));

  pool.resolve("claude", "handmade", "adopt", None).unwrap();
  let overview = pool.overview().unwrap();
  assert!(overview.pool_exists);
  assert_eq!(overview.skills.iter().map(|skill| skill.name.as_str()).collect::<Vec<_>>(), ["handmade"]);
  assert!(fixture.home(".claude/skills/handmade/SKILL.md").is_file());
}

#[test]
fn an_empty_machine_stays_untouched() {
  let fixture = Fixture::new();
  let overview = fixture.pool().overview().unwrap();
  assert!(!overview.pool_exists && overview.skills.is_empty() && overview.duplicates.is_empty());
  assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0, "nothing is created on a machine without skills");
}

#[test]
fn reads_one_skill_for_display_without_leaving_the_pool() {
  let fixture = Fixture::new();
  let path = fixture.skill(".agents/skills", "pdf", "Reads PDF files");
  fs::create_dir_all(path.join("references")).unwrap();
  fs::write(path.join("references/tables.md"), "# Tables").unwrap();
  let pool = fixture.pool();
  let detail = pool.read("pdf").unwrap();
  assert_eq!((detail.title.as_str(), detail.description.as_str()), ("pdf", "Reads PDF files"));
  assert_eq!(detail.files, ["SKILL.md", "references/tables.md"]);
  assert!(detail.content.contains("# pdf") && !detail.truncated);
  assert_eq!(PathBuf::from(&detail.directory), fixture.home(".agents/skills/pdf"));
  assert!(pool.read("missing").is_err());
  assert!(pool.read("../escape").is_err());
}

#[test]
fn reads_the_other_files_a_skill_carries() {
  let fixture = Fixture::new();
  let path = fixture.skill(".agents/skills", "hatch-pet", "Builds pets");
  fs::create_dir_all(path.join("scripts")).unwrap();
  fs::write(path.join("references.md"), "# References\n").unwrap();
  fs::write(path.join("scripts/build.py"), "print('pet')\n").unwrap();
  fs::write(path.join("assets/pet.png"), b"\x89PNG\r\n\x1a\nfake").unwrap_or_else(|_| {
    fs::create_dir_all(path.join("assets")).unwrap();
    fs::write(path.join("assets/pet.png"), b"\x89PNG\r\n\x1a\nfake").unwrap()
  });
  fs::write(path.join("scripts/build.pyc"), [0u8, 159, 146, 150]).unwrap();
  let pool = fixture.pool();

  assert_eq!(pool.read_file("hatch-pet", "references.md").unwrap().kind, "markdown");
  let script = pool.read_file("hatch-pet", "scripts/build.py").unwrap();
  assert_eq!((script.kind.as_str(), script.content.as_str()), ("text", "print('pet')\n"));
  let image = pool.read_file("hatch-pet", "assets/pet.png").unwrap();
  assert_eq!(image.kind, "image");
  assert_eq!(image.content, "data:image/png;base64,iVBORw0KGgpmYWtl");
  fs::write(path.join("assets/tiny.gif"), [0u8, 1, 2, 3]).unwrap();
  assert_eq!(pool.read_file("hatch-pet", "assets/tiny.gif").unwrap().content, "data:image/gif;base64,AAECAw==", "padding is correct");
  assert_eq!(pool.read_file("hatch-pet", "scripts/build.pyc").unwrap().kind, "binary");
  assert!(pool.read_file("hatch-pet", "../pdf/SKILL.md").is_err());
  assert!(pool.read_file("hatch-pet", "missing.md").is_err());
}
