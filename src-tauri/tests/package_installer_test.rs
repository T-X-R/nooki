use app_lib::{capability_runtime::PlatformState, package_installer::{inspect_archive, PackagePayload}};
use std::{fs, io::{Cursor, Write}};
use zip::{write::SimpleFileOptions, ZipWriter};

fn manifest(version: &str) -> String {
  serde_json::json!({ "id": "test.external", "name": "External", "version": version,
    "entrypoints": ["page", "job"], "permissions": ["storage"], "minPlatformVersion": "0.2.0" }).to_string()
}
fn archive(entries: &[(&str, &str)]) -> Vec<u8> {
  let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
  for (name, contents) in entries {
    writer.start_file(*name, SimpleFileOptions::default()).unwrap();
    writer.write_all(contents.as_bytes()).unwrap();
  }
  writer.finish().unwrap().into_inner()
}
fn package(version: &str) -> PackagePayload {
  inspect_archive(&archive(&[("manifest.json", &manifest(version)), ("entry.js", "var WorkbenchCapability = {};")])).unwrap()
}
fn data_dir() -> std::path::PathBuf {
  std::env::temp_dir().join(format!("workbench-package-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
}

#[test]
fn archive_rejects_traversal_unknown_files_and_incompatible_platforms() {
  assert!(inspect_archive(&archive(&[("manifest.json", &manifest("1.0.0")), ("../entry.js", "bad")])).is_err());
  assert!(inspect_archive(&archive(&[("manifest.json", &manifest("1.0.0")), ("entry.js", "ok"), ("nested/file", "bad")])).is_err());
  let future = manifest("1.0.0").replace("0.2.0", "99.0.0");
  assert!(inspect_archive(&archive(&[("manifest.json", &future), ("entry.js", "ok")])).is_err());
  assert!(inspect_archive(b"not a zip").is_err());
}

#[test]
fn installed_package_survives_restart_updates_and_rolls_back_without_deleting_data() {
  let directory = data_dir();
  let state = PlatformState::load(directory.clone()).unwrap();
  state.activate_package(package("1.0.0"), None, false).unwrap();
  let state = PlatformState::load(directory.clone()).unwrap();
  assert_eq!(state.package_payload("test.external", false).unwrap().manifest.version, "1.0.0");
  state.set_capability_enabled("test.external", false).unwrap();
  let updated = state.activate_package(package("1.1.0"), Some("1.0.0".into()), false).unwrap();
  assert!(!updated.enabled);
  assert_eq!(updated.previous_package_version.as_deref(), Some("1.0.0"));
  let previous = state.package_payload("test.external", true).unwrap();
  state.activate_package(previous, Some("1.1.0".into()), true).unwrap();
  assert_eq!(state.package_payload("test.external", false).unwrap().manifest.version, "1.0.0");
  fs::create_dir_all(directory.join("document-library")).unwrap();
  fs::write(directory.join("document-library/keep.md"), "user data").unwrap();
  state.uninstall_capability("test.external").unwrap();
  assert!(directory.join("document-library/keep.md").is_file());
  assert!(!directory.join("installed-capabilities/test.external").exists());
  fs::remove_dir_all(directory).unwrap();
}

#[test]
fn failed_update_keeps_previous_registry_and_executable() {
  let directory = data_dir();
  let state = PlatformState::load(directory.clone()).unwrap();
  state.activate_package(package("1.0.0"), None, false).unwrap();
  assert!(state.activate_package(package("1.1.0"), Some("0.9.0".into()), false).is_err());
  assert!(state.activate_package(package("0.9.0"), Some("1.0.0".into()), false).is_err());
  // Force the registry's temporary write to fail after the new package is saved.
  fs::create_dir(directory.join("installed-capabilities/capability-registry.json.tmp")).unwrap();
  assert!(state.activate_package(package("1.1.0"), Some("1.0.0".into()), false).is_err());
  let restored = PlatformState::load(directory.clone()).unwrap();
  assert_eq!(restored.package_payload("test.external", false).unwrap().manifest.version, "1.0.0");
  fs::remove_dir_all(directory).unwrap();
}

#[test]
fn cancellation_is_retained_for_late_invocations_and_does_not_cancel_retries() {
  let executions = app_lib::task_execution::TaskExecutions::default();
  let running = executions.token("task:1").unwrap();
  executions.cancel("task:1").unwrap();
  assert!(running.is_cancelled());
  assert!(executions.token("task:1").unwrap().is_cancelled());
  assert!(!executions.token("task:2").unwrap().is_cancelled());
}

#[test]
fn task_checkpoints_persist_in_the_desktop_data_directory() {
  let directory = data_dir();
  let state = PlatformState::load(directory.clone()).unwrap();
  let records = vec![serde_json::json!({"id": "task", "checkpoints": {"generate": "report"}})];
  state.write_tasks(&records).unwrap();
  assert_eq!(PlatformState::load(directory.clone()).unwrap().read_tasks().unwrap(), records);
  fs::remove_dir_all(directory).unwrap();
}
