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
