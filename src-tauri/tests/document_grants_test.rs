use app_lib::{
  capability_runtime::{
    CapabilityEntrypoint, CapabilityManifest, CapabilityPermission, PlatformState,
  },
  document_library::DocumentPublication,
};
use std::{
  collections::BTreeMap,
  fs,
  path::PathBuf,
  time::{SystemTime, UNIX_EPOCH},
};

fn manifest(id: &str, name: &str) -> CapabilityManifest {
  CapabilityManifest {
    id: id.into(),
    version: "0.1.0".into(),
    name: name.into(),
    description: String::new(),
    locales: BTreeMap::new(),
    entrypoints: vec![CapabilityEntrypoint::Page],
    permissions: vec![CapabilityPermission::DocumentsPublish],
    min_platform_version: "0.1.0".into(),
  }
}

fn document(content: &str) -> DocumentPublication {
  DocumentPublication {
    key: "2026-09-04".into(),
    title: "2026-09-04 Codex 每日总结".into(),
    collection_key: "daily-reviews".into(),
    collection_name: "每日回顾".into(),
    document_date: "2026-09-04".into(),
    content: content.into(),
  }
}

fn test_data_dir(name: &str) -> PathBuf {
  let nonce = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("test clock should be valid")
    .as_nanos();
  std::env::temp_dir().join(format!("personal-workbench-library-{name}-{nonce}"))
}

fn retry_data_busy<T>(mut operation: impl FnMut() -> Result<T, String>) -> Result<T, String> {
  // Admission can be temporarily busy before any read/effect. Do not retry authorization,
  // recovery-required, or unknown-outcome errors, and never turn an error into an empty result.
  for _ in 0..100 {
    match operation() {
      Err(error) if error == "RESOURCE_BUSY: user data is changing; retry later" => std::thread::sleep(std::time::Duration::from_millis(5)),
      result => return result,
    }
  }
  operation()
}

#[test]
fn selected_documents_are_scoped_persistent_snapshots_with_version_and_permission_checks() {
  let data_dir = test_data_dir("selected-documents");
  let state = PlatformState::load(data_dir.clone()).unwrap();
  state.install_capability(manifest("com.personal.source", "Source")).unwrap();
  let mut reader = manifest("com.personal.reader", "Reader");
  reader.permissions = vec![CapabilityPermission::DocumentsReadSelected];
  state.install_capability(reader.clone()).unwrap();
  let mut other = reader.clone(); other.id = "com.personal.other".into();
  state.install_capability(other).unwrap();
  let first = state.publish_document("com.personal.source", document("Original needle 正文")).unwrap();
  let mut second_doc = document("Not selected"); second_doc.key = "other".into();
  let second = state.publish_document("com.personal.source", second_doc).unwrap();
  assert_eq!(state.search_library_content("NEEDLE").unwrap(), vec![first.id.clone()]);
  assert_eq!(state.search_library_content("正文").unwrap(), vec![first.id.clone()]);
  assert!(state.read_selected_document("com.personal.reader", "grant-1", &first.id).is_err());
  assert!(state.grant_documents("com.personal.source", vec![first.id.clone()], "no-permission").is_err());
  assert!(state.grant_documents("com.personal.reader", vec![], "empty").is_err());
  assert!(state.grant_documents("com.personal.reader", vec![first.id.clone()], "../escape").is_err());
  let grant = state.grant_documents("com.personal.reader", vec![first.id.clone()], "grant-1").unwrap();
  assert_eq!(grant.documents.len(), 1);
  assert!(grant.documents[0].content.is_none());
  assert!(state.grant_documents("com.personal.reader", vec![second.id.clone()], "grant-1").is_err());
  assert!(state.read_selected_document("com.personal.reader", "grant-1", &second.id).is_err());
  assert!(state.read_selected_document("com.personal.other", "grant-1", &first.id).is_err());
  state.publish_document("com.personal.source", document("Rewritten")).unwrap();
  let restarted = PlatformState::load(data_dir.clone()).unwrap();
  assert_eq!(restarted.document_grants("com.personal.reader").unwrap().len(), 1);
  assert_eq!(restarted.read_selected_document("com.personal.reader", "grant-1", &first.id).unwrap().content.as_deref(), Some("Original needle 正文"));
  restarted.set_capability_enabled("com.personal.reader", false).unwrap();
  assert!(restarted.read_selected_document("com.personal.reader", "grant-1", &first.id).is_err());
  restarted.set_capability_enabled("com.personal.reader", true).unwrap();
  assert!(restarted.read_selected_document("com.personal.reader", "grant-1", &first.id).is_err(), "reenabling must not revive an old activation grant");
  reader.version = "0.2.0".into(); restarted.update_capability(reader).unwrap();
  assert!(restarted.document_grants("com.personal.reader").unwrap().is_empty());
  assert!(restarted.read_selected_document("com.personal.reader", "grant-1", &first.id).is_err());
  restarted.uninstall_capability("com.personal.reader").unwrap();
  restarted.uninstall_capability("com.personal.source").unwrap();
  assert!(restarted.read_selected_document("com.personal.reader", "grant-1", &first.id).is_err());
  assert_eq!(restarted.read_document_source("grant-1", &first.id).unwrap().content.as_deref(), Some("Original needle 正文"));
  assert!(restarted.read_document_source("grant-1", &second.id).is_err());
  fs::remove_dir_all(data_dir).unwrap();
}

#[test]
fn reinstalling_the_same_version_does_not_reauthorize_old_snapshots() {
  let root=test_data_dir("reinstall");let state=PlatformState::load(root.clone()).unwrap();
  let mut reader=manifest("com.personal.reader","Reader");reader.permissions=vec![CapabilityPermission::DocumentsReadSelected];
  state.install_capability(reader.clone()).unwrap();state.install_capability(manifest("com.personal.source","Source")).unwrap();
  let doc=state.publish_document("com.personal.source",document("Retained citation")).unwrap();
  state.grant_documents(&reader.id,vec![doc.id.clone()],"same-version").unwrap();
  state.uninstall_capability(&reader.id).unwrap();state.install_capability(reader.clone()).unwrap();
  assert!(state.read_selected_document(&reader.id,"same-version",&doc.id).is_err());
  assert!(state.document_grants(&reader.id).unwrap().is_empty());
  assert_eq!(state.read_document_source("same-version",&doc.id).unwrap().content.as_deref(),Some("Retained citation"));
  fs::remove_dir_all(root).unwrap();
}

#[test]
fn revocation_is_idempotent_persistent_and_does_not_destroy_user_citations() {
  let root=test_data_dir("revoke");let state=PlatformState::load(root.clone()).unwrap();
  let mut reader=manifest("com.personal.reader","Reader");reader.permissions=vec![CapabilityPermission::DocumentsReadSelected];
  state.install_capability(reader.clone()).unwrap();state.install_capability(manifest("com.personal.source","Source")).unwrap();
  let doc=state.publish_document("com.personal.source",document("Keep for the user")).unwrap();
  state.grant_documents(&reader.id,vec![doc.id.clone()],"revoke-one").unwrap();
  let before=fs::read(root.join("document-grants/revoke-one.json")).unwrap();
  state.revoke_document_grant("revoke-one").unwrap();state.revoke_document_grant("revoke-one").unwrap();
  assert!(state.read_selected_document(&reader.id,"revoke-one",&doc.id).is_err());
  assert!(state.document_grants(&reader.id).unwrap().is_empty());
  let state=PlatformState::load(root.clone()).unwrap();
  assert!(state.read_selected_document(&reader.id,"revoke-one",&doc.id).is_err());
  assert_eq!(fs::read(root.join("document-grants/revoke-one.json")).unwrap(),before);
  assert_eq!(state.read_document_source("revoke-one",&doc.id).unwrap().content.as_deref(),Some("Keep for the user"));
  assert!(state.revoke_document_grant("../escape").is_err());
  assert!(state.revoke_document_grant("missing").is_err());
  fs::remove_dir_all(root).unwrap();
}

struct SelectionFixture { root: PathBuf, state: PlatformState, reader: CapabilityManifest, document_id: String }
impl SelectionFixture {
  fn new(name: &str) -> Self {
    let root = test_data_dir(name);
    let state = PlatformState::load(root.clone()).unwrap();
    let mut reader = manifest("com.personal.reader", "Reader");
    reader.permissions = vec![CapabilityPermission::DocumentsReadSelected];
    state.install_capability(reader.clone()).unwrap();
    state.install_capability(manifest("com.personal.source", "Source")).unwrap();
    let doc = state.publish_document("com.personal.source", document("Selected original")).unwrap();
    Self { root, state, reader, document_id: doc.id }
  }
  fn grant(&self, id: &str) {
    self.state.grant_documents(&self.reader.id, vec![self.document_id.clone()], id).unwrap();
  }
}
impl Drop for SelectionFixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }

#[test]
fn restored_data_preserves_citations_without_reviving_local_or_foreign_authority() {
  use app_lib::user_data;
  let fixture = SelectionFixture::new("restore-grant");
  let before_selection = user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!(fixture.state.list_capabilities().unwrap())).unwrap();
  fixture.grant("before-backup");
  let backup = user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!(fixture.state.list_capabilities().unwrap())).unwrap();
  fixture.state.revoke_document_grant("before-backup").unwrap();
  user_data::restore(&fixture.root, &backup, "restore-before-revoke").unwrap();
  let restarted = PlatformState::load(fixture.root.clone()).unwrap();
  assert!(restarted.read_selected_document(&fixture.reader.id, "before-backup", &fixture.document_id).is_err());
  assert!(restarted.document_grants(&fixture.reader.id).unwrap().is_empty());
  assert_eq!(restarted.read_document_source("before-backup", &fixture.document_id).unwrap().content.as_deref(), Some("Selected original"));
  let new_installation = SelectionFixture::new("restore-other-installation");
  user_data::restore(&new_installation.root, &backup, "restore-on-another-installation").unwrap();
  assert!(new_installation.state.read_selected_document(&fixture.reader.id, "before-backup", &fixture.document_id).is_err());
  assert!(new_installation.state.document_grants(&fixture.reader.id).unwrap().is_empty());
  assert_eq!(new_installation.state.read_document_source("before-backup", &fixture.document_id).unwrap().content.as_deref(), Some("Selected original"));
  // Restoring user data does not import the local revocation journal or installation generation.
  assert!(backup.files.keys().all(|key| !key.starts_with("document-grant-revocations/")));
  user_data::restore(&fixture.root, &before_selection, "restore-before-selection").unwrap();
  assert!(!fixture.root.join("document-grants/before-backup.json").exists());
  // An existing revocation remains an idempotent success even if data restore removed its snapshot.
  restarted.revoke_document_grant("before-backup").unwrap();
}

#[test]
fn legacy_snapshots_require_reselection_and_stale_hosts_use_current_registry() {
  let fixture = SelectionFixture::new("legacy-grant");
  fixture.grant("legacy");
  let path = fixture.root.join("document-grants/legacy.json");
  let mut old: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
  old.as_object_mut().unwrap().remove("activationGeneration");
  fs::write(path, serde_json::to_vec(&old).unwrap()).unwrap();
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "legacy", &fixture.document_id).is_err());
  assert!(retry_data_busy(|| fixture.state.document_grants(&fixture.reader.id)).unwrap().is_empty());
  assert_eq!(fixture.state.read_document_source("legacy", &fixture.document_id).unwrap().content.as_deref(), Some("Selected original"));
  fixture.grant("reselected");
  let other_host = PlatformState::load(fixture.root.clone()).unwrap();
  other_host.set_capability_enabled(&fixture.reader.id, false).unwrap();
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "reselected", &fixture.document_id).is_err());
  assert!(fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "stale-host").is_err());
  assert!(!fixture.root.join("document-grants/stale-host.json").exists());
  other_host.set_capability_enabled(&fixture.reader.id, true).unwrap();
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "reselected", &fixture.document_id).is_err());
}

#[test]
fn replay_keeps_the_original_selection_and_recovers_an_unpublished_staging_file() {
  let fixture = SelectionFixture::new("grant-replay");
  fixture.grant("stable");
  let before = fs::read(fixture.root.join("document-grants/stable.json")).unwrap();
  fixture.state.publish_document("com.personal.source", document("Edited after selection")).unwrap();
  fixture.grant("stable");
  assert_eq!(fs::read(fixture.root.join("document-grants/stable.json")).unwrap(), before);
  assert_eq!(fixture.state.read_selected_document(&fixture.reader.id, "stable", &fixture.document_id).unwrap().content.as_deref(), Some("Selected original"));
  fixture.state.revoke_document_grant("stable").unwrap();
  assert!(fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "stable").is_err());
  assert_eq!(fs::read(fixture.root.join("document-grants/stable.json")).unwrap(), before);
  // A process crash before exclusive publication leaves only this staging file. It grants no access.
  fs::write(fixture.root.join("document-grants/interrupted.pending"), b"partial write").unwrap();
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "interrupted", &fixture.document_id).is_err());
  fixture.grant("interrupted");
  assert_eq!(fixture.state.read_selected_document(&fixture.reader.id, "interrupted", &fixture.document_id).unwrap().content.as_deref(), Some("Edited after selection"));
  assert!(!fixture.root.join("document-grants/interrupted.pending").exists());
}

#[cfg(unix)]
#[test]
fn write_failures_do_not_acknowledge_revocation_or_unconfirmed_grant_durability() {
  use std::os::unix::fs::PermissionsExt;
  struct RestorePermissions(PathBuf);
  impl Drop for RestorePermissions { fn drop(&mut self) { fs::set_permissions(&self.0, fs::Permissions::from_mode(0o700)).unwrap(); } }
  let fixture = SelectionFixture::new("grant-durability");
  fixture.grant("live");
  let staging = fixture.root.join("document-grant-revocations/live.pending");
  fs::create_dir_all(&staging).unwrap();
  assert!(fixture.state.revoke_document_grant("live").is_err());
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "live", &fixture.document_id).is_ok());
  fs::remove_dir(&staging).unwrap();
  // Write+traverse but no directory-read: publication succeeds; opening the root for sync fails.
  let restore = RestorePermissions(fixture.root.clone());
  fs::set_permissions(&fixture.root, fs::Permissions::from_mode(0o300)).unwrap();
  let revoke_error = fixture.state.revoke_document_grant("live").unwrap_err();
  let revoke_retry = fixture.state.revoke_document_grant("live").unwrap_err();
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "live", &fixture.document_id).is_err());
  let grant_error = fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "uncertain").unwrap_err();
  let grant_retry = fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "uncertain").unwrap_err();
  drop(restore);
  for error in [revoke_error, revoke_retry, grant_error, grant_retry] { assert!(error.contains("OUTCOME_UNKNOWN"), "{error}"); }
  let saved = fs::read(fixture.root.join("document-grants/uncertain.json")).unwrap();
  fixture.state.revoke_document_grant("live").unwrap();
  fixture.grant("uncertain");
  assert_eq!(fs::read(fixture.root.join("document-grants/uncertain.json")).unwrap(), saved);
  assert!(fixture.state.read_document_source("live", &fixture.document_id).is_ok());
}

#[test]
fn selected_reads_wait_for_the_library_restore_transaction() {
  use std::{sync::mpsc, time::Duration};
  let fixture = SelectionFixture::new("read-during-restore");
  fixture.grant("selected");
  let guard = app_lib::library_management::DATA_LOCK.lock().unwrap();
  // Reproduce the restore interval after removing a managed root and before publishing its replacement.
  let active = fixture.root.join("document-grants");
  let staged = fixture.root.join("restore-grants-test");
  fs::rename(&active, &staged).unwrap();
  let (started_tx, started_rx) = mpsc::channel();
  let (result_tx, result_rx) = mpsc::channel();
  std::thread::scope(|scope| {
    scope.spawn(|| {
      started_tx.send(()).unwrap();
      let result = fixture.state.read_selected_document(&fixture.reader.id, "selected", &fixture.document_id);
      result_tx.send(result).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let premature = result_rx.recv_timeout(Duration::from_millis(100));
    fs::rename(&staged, &active).unwrap();
    drop(guard);
    assert!(matches!(premature, Err(mpsc::RecvTimeoutError::Timeout)), "read escaped an in-progress restore: {premature:?}");
    assert_eq!(result_rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap().content.as_deref(), Some("Selected original"));
  });
}

#[test]
fn restore_cannot_reuse_a_removed_grant_id_for_new_content() {
  let fixture = SelectionFixture::new("restore-replay");
  let before = app_lib::user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!([])).unwrap();
  fixture.grant("consumed");
  app_lib::user_data::restore(&fixture.root, &before, "before-grant").unwrap();
  fixture.state.publish_document("com.personal.source", document("Different content")).unwrap();
  let result = fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "consumed");
  assert!(result.is_err(), "restore must not allow a previously returned snapshot ID to change content");
  fixture.grant("new-selection");
  assert_eq!(fixture.state.read_selected_document(&fixture.reader.id, "new-selection", &fixture.document_id).unwrap().content.as_deref(), Some("Different content"));
}

#[cfg(unix)]
#[test]
fn document_restore_lock_child() {
  use std::{os::fd::AsRawFd, time::{Duration, Instant}};
  let Some(root) = std::env::var_os("NOOKI_DOCUMENT_LOCK_FIXTURE") else { return; };
  let root = PathBuf::from(root);
  let file = fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(root.join("task-data.lock")).unwrap();
  // The child represents another native process owning a user-data transaction.
  assert_eq!(unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
  fs::write(root.join("child-ready"), b"ready").unwrap();
  let deadline = Instant::now() + Duration::from_secs(5);
  while !root.join("child-release").exists() {
    assert!(Instant::now() < deadline, "parent did not release child");
    std::thread::sleep(Duration::from_millis(5));
  }
}

#[cfg(unix)]
#[test]
fn another_process_blocks_grant_read_revoke_and_restore_until_it_releases_data() {
  use std::{process::{Child, Command, Stdio}, time::{Duration, Instant}};
  struct ChildGuard(Child);
  impl Drop for ChildGuard { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
  let fixture = SelectionFixture::new("process-restore-fence");
  fixture.grant("existing");
  let backup = app_lib::user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!([])).unwrap();
  let mut child = ChildGuard(Command::new(std::env::current_exe().unwrap())
    .args(["--exact", "document_restore_lock_child", "--nocapture"])
    .env("NOOKI_DOCUMENT_LOCK_FIXTURE", &fixture.root).stdout(Stdio::null()).spawn().unwrap());
  let deadline = Instant::now() + Duration::from_secs(5);
  while !fixture.root.join("child-ready").exists() {
    assert!(child.0.try_wait().unwrap().is_none() && Instant::now() < deadline);
    std::thread::sleep(Duration::from_millis(5));
  }
  for error in [
    fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "new").unwrap_err(),
    fixture.state.read_selected_document(&fixture.reader.id, "existing", &fixture.document_id).unwrap_err(),
    fixture.state.document_grants(&fixture.reader.id).unwrap_err(),
    fixture.state.revoke_document_grant("existing").unwrap_err(),
    fixture.state.read_document_source("existing", &fixture.document_id).unwrap_err(),
  ] { assert!(error.starts_with("RESOURCE_BUSY:"), "{error}"); }
  assert!(app_lib::user_data::restore(&fixture.root, &backup, "busy").is_err());
  assert!(!fixture.root.join("document-grants/new.json").exists());
  assert!(!fixture.root.join("document-grant-revocations/existing.json").exists());
  fs::write(fixture.root.join("child-release"), b"release").unwrap();
  assert!(child.0.wait().unwrap().success());
  fixture.grant("new");
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "existing", &fixture.document_id).is_ok());
  fixture.state.revoke_document_grant("existing").unwrap();
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "existing", &fixture.document_id).is_err());
}

#[test]
fn interrupted_restore_recovery_invalidates_replaced_grants_and_keeps_the_original_citation() {
  let fixture = SelectionFixture::new("grant-recovery");
  fixture.grant("original");
  let previous = app_lib::user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!([])).unwrap();
  fixture.state.publish_document("com.personal.source", document("After backup")).unwrap();
  fixture.grant("later");
  let staging = fixture.root.join(".data-restore");
  for (name, content) in previous.files {
    let target = staging.join("previous").join(name);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, content).unwrap();
  }
  fs::write(staging.join("prepared.json"), b"\"interrupted\"").unwrap();
  app_lib::user_data::recover(&fixture.root).unwrap();
  assert_eq!(fixture.state.read_document_source("original", &fixture.document_id).unwrap().content.as_deref(), Some("Selected original"));
  assert!(fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "later").is_err());
  fixture.state.revoke_document_grant("later").unwrap();
  assert!(!staging.exists());
}

#[test]
fn an_interrupted_restore_cannot_recapture_an_unchanged_snapshot_id() {
  let fixture = SelectionFixture::new("incomplete-restore");
  fixture.grant("unchanged");
  fixture.state.publish_document("com.personal.source", document("Edited source; original grant stays immutable")).unwrap();
  let backup = app_lib::user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!([])).unwrap();
  let staging = fixture.root.join(".data-restore");
  for (name, content) in backup.files {
    let target = staging.join("previous").join(name);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, content).unwrap();
  }
  fs::write(staging.join("prepared.json"), b"\"interrupted\"").unwrap();
  // A crash after removing an unchanged managed root leaves no revocation marker and releases locks.
  fs::remove_dir_all(fixture.root.join("document-grants")).unwrap();
  assert!(!fixture.root.join("document-grant-revocations/unchanged.json").exists());
  for error in [
    fixture.state.grant_documents(&fixture.reader.id, vec![fixture.document_id.clone()], "unchanged").unwrap_err(),
    fixture.state.document_grants(&fixture.reader.id).unwrap_err(),
    fixture.state.read_selected_document(&fixture.reader.id, "unchanged", &fixture.document_id).unwrap_err(),
    fixture.state.read_document_source("unchanged", &fixture.document_id).unwrap_err(),
    fixture.state.revoke_document_grant("unchanged").unwrap_err(),
  ] { assert!(error.starts_with("RESOURCE_BUSY:"), "{error}"); }
  assert!(!fixture.root.join("document-grants/unchanged.json").exists());
  app_lib::user_data::recover(&fixture.root).unwrap();
  fixture.grant("unchanged");
  assert_eq!(fixture.state.read_selected_document(&fixture.reader.id, "unchanged", &fixture.document_id).unwrap().content.as_deref(), Some("Selected original"));
}

#[test]
fn a_committed_restore_transaction_cannot_be_reused_for_another_replacement() {
  let fixture = SelectionFixture::new("restore-id-reuse");
  let backup = app_lib::user_data::capture(&fixture.root, BTreeMap::new(), serde_json::json!([])).unwrap();
  app_lib::user_data::restore(&fixture.root, &backup, "already-committed").unwrap();
  fixture.grant("newer-selection");
  let before = fs::read(fixture.root.join("document-grants/newer-selection.json")).unwrap();
  let replay = app_lib::user_data::restore(&fixture.root, &backup, "already-committed");
  assert!(replay.is_err(), "a reused restore ID must not start another replacement");
  assert_eq!(fs::read(fixture.root.join("document-grants/newer-selection.json")).unwrap(), before);
  assert!(fixture.state.read_selected_document(&fixture.reader.id, "newer-selection", &fixture.document_id).is_ok());
  assert!(!fixture.root.join(".data-restore").exists());
}
