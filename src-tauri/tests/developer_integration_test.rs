use app_lib::developer_integration::{bundled_files, DeveloperIntegration, SKILL_NAME};
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
  fn new() -> Self {
    let root = std::env::temp_dir().join(format!("workbench-integration-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
    fs::create_dir(&root).unwrap(); Self(root)
  }
  fn integration(&self) -> DeveloperIntegration { DeveloperIntegration::new(self.0.clone(), bundled_files()) }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

#[test]
fn inspection_is_read_only_and_install_is_complete_and_idempotent() {
  let fixture = Fixture::new();
  let integration = fixture.integration();
  assert_eq!(integration.inspect("codex").unwrap().status, "missing");
  assert!(!fixture.0.join(".agents").exists());
  let installed = integration.install("codex").unwrap();
  assert_eq!(installed.status, "current");
  let skill = fixture.0.join(".agents/skills").join(SKILL_NAME);
  for (path, content) in bundled_files() { assert_eq!(fs::read_to_string(skill.join(path)).unwrap(), content); }
  assert_eq!(integration.install("codex").unwrap().status, "current");
  assert!(!fixture.0.join(".claude").exists());
}

#[test]
fn detects_claude_configuration_and_installs_only_into_its_skills_directory() {
  let fixture = Fixture::new();
  fs::create_dir(fixture.0.join(".claude")).unwrap();
  fs::write(fixture.0.join(".claude/settings.json"), "personal settings").unwrap();
  let integration = fixture.integration();
  assert!(integration.inspect("claude").unwrap().detected);
  let installed = integration.install("claude").unwrap();
  assert_eq!(PathBuf::from(installed.directory), fixture.0.join(".claude/skills").join(SKILL_NAME));
  assert_eq!(fs::read_to_string(fixture.0.join(".claude/settings.json")).unwrap(), "personal settings");
}

#[test]
fn updates_owned_skill_and_preserves_unrelated_skills() {
  let fixture = Fixture::new();
  let mut old = bundled_files();
  old.insert("kit.json".into(), "{\"version\":\"0.0.1\",\"platformVersion\":\"0.3.0\"}".into());
  old.insert("retired.md".into(), "old resource".into());
  DeveloperIntegration::new(fixture.0.clone(), old).install("codex").unwrap();
  let sibling = fixture.0.join(".agents/skills/my-skill");
  fs::create_dir(&sibling).unwrap(); fs::write(sibling.join("SKILL.md"), "user skill").unwrap();
  let integration = fixture.integration();
  assert_eq!(integration.inspect("codex").unwrap().status, "update");
  assert_eq!(integration.install("codex").unwrap().status, "current");
  assert!(!fixture.0.join(".agents/skills").join(SKILL_NAME).join("retired.md").exists());
  assert_eq!(fs::read_to_string(sibling.join("SKILL.md")).unwrap(), "user skill");
}

#[test]
fn edits_additions_deletions_and_unmanaged_skills_are_preserved() {
  for mutation in ["edit", "add", "delete", "receipt"] {
    let fixture = Fixture::new();
    let integration = fixture.integration();
    let path = PathBuf::from(integration.install("claude").unwrap().directory);
    match mutation {
      "edit" => fs::write(path.join("SKILL.md"), "my own instructions").unwrap(),
      "add" => fs::write(path.join("my-notes.md"), "keep me").unwrap(),
      "delete" => fs::remove_file(path.join("SKILL.md")).unwrap(),
      _ => fs::remove_file(path.join(".workbench-integration.json")).unwrap(),
    }
    assert_eq!(integration.inspect("claude").unwrap().status, "modified");
    assert!(integration.install("claude").is_err());
    if mutation == "edit" { assert_eq!(fs::read_to_string(path.join("SKILL.md")).unwrap(), "my own instructions"); }
    if mutation == "add" { assert_eq!(fs::read_to_string(path.join("my-notes.md")).unwrap(), "keep me"); }
    if mutation == "delete" { assert!(!path.join("SKILL.md").exists()); }
  }
}

#[test]
fn refuses_downgrade_and_invalid_tool() {
  let fixture = Fixture::new();
  let mut future = bundled_files();
  future.insert("kit.json".into(), "{\"version\":\"99.0.0\",\"platformVersion\":\"0.3.0\"}".into());
  DeveloperIntegration::new(fixture.0.clone(), future).install("codex").unwrap();
  let integration = fixture.integration();
  assert_eq!(integration.inspect("codex").unwrap().status, "newer");
  assert!(integration.install("codex").is_err());
  assert!(integration.install("unknown").is_err());

}

#[cfg(unix)]
#[test]
fn preserves_linked_skill_and_linked_files() {
  use std::os::unix::fs::symlink;
  let fixture = Fixture::new();
  let root = fixture.0.join(".agents/skills"); fs::create_dir_all(&root).unwrap();
  let outside = fixture.0.join("outside"); fs::create_dir(&outside).unwrap();
  fs::write(outside.join("SKILL.md"), "keep me").unwrap();
  symlink(&outside, root.join(SKILL_NAME)).unwrap();
  let integration = fixture.integration();
  assert_eq!(integration.inspect("codex").unwrap().status, "modified");
  assert!(integration.install("codex").is_err());
  assert_eq!(fs::read_to_string(outside.join("SKILL.md")).unwrap(), "keep me");
  fs::remove_file(root.join(SKILL_NAME)).unwrap();
  integration.install("codex").unwrap();
  symlink(&outside, root.join(SKILL_NAME).join("linked")).unwrap();
  assert_eq!(integration.inspect("codex").unwrap().status, "modified");
  assert!(integration.install("codex").is_err());
}

#[test]
fn interrupted_swap_can_restore_previous_skill_without_overwriting_changes() {
  let fixture = Fixture::new();
  let integration = fixture.integration();
  let path = PathBuf::from(integration.install("codex").unwrap().directory);
  let backup = path.parent().unwrap().join(".workbench-capability-dev.previous");
  fs::rename(path, &backup).unwrap();
  assert_eq!(integration.inspect("codex").unwrap().status, "recovery");
  assert_eq!(integration.install("codex").unwrap().status, "current");
  assert!(!backup.exists());
}

#[test]
fn exports_a_portable_archive_with_the_same_files_as_installation() {
  let fixture = Fixture::new();
  let archive = fixture.integration().export_archive().unwrap();
  let mut zip = zip::ZipArchive::new(fs::File::open(archive).unwrap()).unwrap();
  let files = bundled_files(); assert_eq!(zip.len(), files.len());
  for (name, content) in files {
    let mut file = zip.by_name(&format!("{SKILL_NAME}/{name}")).unwrap();
    let mut actual = String::new(); std::io::Read::read_to_string(&mut file, &mut actual).unwrap();
    assert_eq!(actual, content);
  }
}
