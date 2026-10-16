use app_lib::{document_library::{self as library, DocumentPublication}, library_management::{self as management, LibraryChange, Topic}, source_snapshots, user_data};
use std::{collections::BTreeMap, fs, path::PathBuf};
static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
struct Fixture(PathBuf);
impl Fixture { fn new() -> Self { Self(std::env::temp_dir().join(format!("workbench-library-management-{}-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)))) } }
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn document(content: &str) -> DocumentPublication { DocumentPublication { key: "entry".into(), title: "Title".into(), content: content.into(), document_date: "2026-09-09".into(), collection_key: "notes".into(), collection_name: "Notes".into() } }
#[test]
fn created_documents_are_readable_revisioned_and_linked_to_the_current_topic() {
  let root = Fixture::new();
  management::change(&root.0, LibraryChange::SaveTopic { topic: Topic { id: "research".into(), name: "Research".into(), document_ids: vec![] } }).unwrap();
  let change = serde_json::from_value(serde_json::json!({ "kind": "create", "document": document("# Notes\n\n直接写作。"), "topicId": "research" })).unwrap();
  let doc = management::change(&root.0, change).unwrap().unwrap();
  assert_eq!(doc.capability_id, "workbench.documents");
  assert_eq!(doc.collection_key, "documents");
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "# Notes\n\n直接写作。");
  assert_eq!(management::organization(&root.0).unwrap().topics[0].document_ids, vec![doc.id.clone()]);
  management::change(&root.0, LibraryChange::Edit { id: doc.id.clone(), title: "Revised".into(), content: "Updated".into(), expected: doc.revision.unwrap() }).unwrap();
  assert_eq!(management::history(&root.0, &doc.id).unwrap().len(), 2);
}
#[test]
fn creation_validates_content_and_topic_before_publishing() {
  let root = Fixture::new();
  for (content, topic) in [(" ", None), ("Valid", Some("deleted"))] {
    let change = serde_json::from_value(serde_json::json!({ "kind": "create", "document": document(content), "topicId": topic })).unwrap();
    assert!(management::change(&root.0, change).is_err());
    assert!(library::list_documents(&root.0).unwrap().is_empty());
  }
}
#[test]
fn revisions_detect_conflicts_restore_without_losing_versions_and_keep_snapshot_evidence() {
  let root = Fixture::new();
  let doc = library::publish_document(&root.0, "com.personal.notes", "Notes", document("original")).unwrap();
  source_snapshots::capture(&root.0, "snapshot", std::slice::from_ref(&doc.id)).unwrap();
  let edited = management::change(&root.0, LibraryChange::Edit { id: doc.id.clone(), title: "Updated".into(), content: "new".into(), expected: doc.revision.clone().unwrap() }).unwrap().unwrap();
  assert_eq!(doc.id, edited.id);
  assert!(management::change(&root.0, LibraryChange::Edit { id: doc.id.clone(), title: "Stale".into(), content: "stale".into(), expected: doc.revision.clone().unwrap() }).is_err());
  management::change(&root.0, LibraryChange::RestoreVersion { id: doc.id.clone(), revision: doc.revision.unwrap(), expected: edited.revision.unwrap() }).unwrap();
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "original");
  assert_eq!(management::history(&root.0, &doc.id).unwrap().len(), 3);
  assert_eq!(source_snapshots::source(&root.0, "snapshot", &doc.id).unwrap().content, "original");
}
#[test]
fn topics_cross_sources_and_trash_blocks_republication_and_purge_keeps_snapshots() {
  let root = Fixture::new();
  let first = management::change(&root.0, LibraryChange::Import { document: document("imported") }).unwrap().unwrap();
  let second = library::publish_document(&root.0, "com.personal.diary", "Diary", document("diary")).unwrap();
  management::change(&root.0, LibraryChange::SaveTopic { topic: Topic { id: "project".into(), name: " Project ".into(), document_ids: vec![first.id.clone(), second.id.clone()] } }).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().topics[0].name, "Project");
  source_snapshots::capture(&root.0, "snapshot", std::slice::from_ref(&first.id)).unwrap();
  management::change(&root.0, LibraryChange::Trash { ids: vec![first.id.clone()] }).unwrap();
  assert_eq!(library::list_documents(&root.0).unwrap().len(), 1);
  assert!(management::change(&root.0, LibraryChange::Import { document: document("republished") }).is_err());
  management::change(&root.0, LibraryChange::Restore { ids: vec![first.id.clone()] }).unwrap();
  assert_eq!(library::list_documents(&root.0).unwrap().len(), 2);
  management::change(&root.0, LibraryChange::Trash { ids: vec![first.id.clone()] }).unwrap();
  management::change(&root.0, LibraryChange::Purge { ids: vec![first.id.clone()] }).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().topics[0].document_ids, vec![second.id.clone()]);
  assert_eq!(source_snapshots::source(&root.0, "snapshot", &first.id).unwrap().content, "imported");
  management::change(&root.0, LibraryChange::DeleteTopic { id: "project".into() }).unwrap();
  assert!(library::read_document(&root.0, &second.id).is_ok());
}
#[test]
fn backup_round_trip_and_rejection_leave_existing_data_intact() {
  let root = Fixture::new();
  let doc = library::publish_document(&root.0, "com.personal.notes", "Notes", document("saved")).unwrap();
  source_snapshots::capture(&root.0, "snapshot", std::slice::from_ref(&doc.id)).unwrap();
  let local = BTreeMap::from([("personal-workbench:capability:com.personal.notes:entries".into(), "[]".into())]);
  let backup = user_data::capture(&root.0, local, serde_json::json!([])).unwrap();
  library::publish_document(&root.0, "com.personal.notes", "Notes", document("changed")).unwrap();
  let mut invalid = backup.clone(); invalid.files.insert("../outside.json".into(), "{}".into());
  assert!(user_data::restore(&root.0, &invalid, "invalid").is_err());
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "changed");
  let mut corrupt = backup.clone(); corrupt.files.insert(format!("document-library/{}.json", doc.id), "{}".into());
  assert!(user_data::restore(&root.0, &corrupt, "corrupt").is_err());
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "changed");
  user_data::restore(&root.0, &backup, "restored").unwrap();
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "saved");
  assert_eq!(source_snapshots::source(&root.0, "snapshot", &doc.id).unwrap().content, "saved");
  assert_eq!(user_data::restored_id(&root.0).unwrap().as_deref(), Some("restored"));
}
#[test]
fn unfinished_restore_recovers_previous_files_at_startup() {
  let root = Fixture::new();
  let dir = root.0.join(".data-restore");
  fs::create_dir_all(dir.join("previous")).unwrap();
  fs::write(dir.join("previous/tasks.json"), "[]").unwrap();
  fs::write(dir.join("prepared.json"), "\"incomplete\"").unwrap();
  fs::write(root.0.join("tasks.json"), "[{}]").unwrap();
  user_data::recover(&root.0).unwrap();
  assert_eq!(fs::read_to_string(root.0.join("tasks.json")).unwrap(), "[]");
  assert!(!dir.exists());
}

#[test]
fn backup_rejects_malformed_auxiliary_records_before_replacing_data() {
  let root = Fixture::new();
  let doc = library::publish_document(&root.0, "com.personal.notes", "Notes", document("keep me")).unwrap();
  let backup = user_data::capture(&root.0, BTreeMap::new(), serde_json::json!([])).unwrap();
  for (name, value) in [("tasks.json", "[{}]"), ("tasks.json/inside.json", "{}"), ("source-snapshots/broken.json", "{}"), ("document-grants/broken.json", "{}")] {
    let mut invalid = backup.clone(); invalid.files.insert(name.into(), value.into());
    assert!(user_data::restore(&root.0, &invalid, "invalid").is_err());
    assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "keep me");
  }
}

#[test]
fn backup_restores_document_working_copies_and_retained_turn_results_together() {
  use app_lib::conversation_documents::{self as documents, DocumentInputs};
  let root = Fixture::new();
  documents::prepare(&root.0, "session", "first", &DocumentInputs::default()).unwrap();
  let workspace = documents::workspace(&root.0, "session");
  fs::write(workspace.join("draft.txt"), "First draft").unwrap();
  let first = documents::complete(&root.0, "session", "first").unwrap();
  fs::write(workspace.join("scratch.py"), "not a document").unwrap();
  let backup = user_data::capture(&root.0, BTreeMap::new(), serde_json::json!([])).unwrap();
  assert!(backup.files.keys().any(|name| name.starts_with("conversation-document-state/") && name.ends_with("-output.json")));
  assert!(backup.files.keys().any(|name| name.ends_with("draft.txt")));
  assert!(!backup.files.keys().any(|name| name.ends_with("scratch.py")));
  fs::write(workspace.join("draft.txt"), "Later draft").unwrap();
  user_data::restore(&root.0, &backup, "document-restore").unwrap();
  assert_eq!(fs::read_to_string(workspace.join("draft.txt")).unwrap(), "First draft");
  assert_eq!(documents::complete(&root.0, "session", "first").unwrap()[0].content, first[0].content);
}

#[test]
fn backup_retains_native_conversation_mapping_and_pi_sessions() {
  let root = Fixture::new();
  fs::create_dir_all(&root.0).unwrap();
  fs::write(root.0.join("conversation-agents.json"), r#"{"sessions":{}}"#).unwrap();
  fs::create_dir_all(root.0.join("agent-sessions")).unwrap();
  fs::write(root.0.join("agent-sessions/pi-session.jsonl"), "{\"type\":\"session\"}\n").unwrap();
  let backup = user_data::capture(&root.0, BTreeMap::new(), serde_json::json!([])).unwrap();
  assert_eq!(backup.files.get("conversation-agents.json").unwrap(), r#"{"sessions":{}}"#);
  assert_eq!(backup.files.get("agent-sessions/pi-session.jsonl").unwrap(), "{\"type\":\"session\"}\n");
}

#[test]
fn conversation_placement_keeps_source_and_atomically_links_topic_with_idempotent_retry() {
  let root = Fixture::new();
  let doc = library::publish_document(&root.0, "workbench.conversations", "Conversations", document("conversation result")).unwrap();
  management::change(&root.0, LibraryChange::SaveTopic { topic: Topic { id: "research".into(), name: "Research".into(), document_ids: vec![] } }).unwrap();
  for _ in 0..2 {
    management::change(&root.0, LibraryChange::Place { id: doc.id.clone(), topic_id: Some("research".into()), section: management::LibrarySection { id: "diary".into(), name: "日记".into(), topic_id: None } }).unwrap();
  }
  let state = management::organization(&root.0).unwrap();
  assert_eq!(state.topics[0].document_ids, vec![doc.id.clone()]);
  assert_eq!(state.sections[&doc.id].id, "diary");
  let saved = library::read_document(&root.0, &doc.id).unwrap();
  assert_eq!(saved.capability_id, "workbench.conversations");
  assert_eq!(saved.content, "conversation result");
  assert!(management::change(&root.0, LibraryChange::Place { id: doc.id.clone(), topic_id: Some("deleted".into()), section: management::LibrarySection { id: "other".into(), name: "Other".into(), topic_id: None } }).is_err());
  assert_eq!(management::organization(&root.0).unwrap().sections[&doc.id].id, "diary");
  management::change(&root.0, LibraryChange::Trash { ids: vec![doc.id.clone()] }).unwrap();
  management::change(&root.0, LibraryChange::Purge { ids: vec![doc.id.clone()] }).unwrap();
  assert!(!management::organization(&root.0).unwrap().sections.contains_key(&doc.id));
}

#[test]
fn empty_custom_sections_survive_backup_and_moving_preserves_document_identity() {
  use management::LibrarySection;
  let root = Fixture::new();
  fs::create_dir_all(&root.0).unwrap();
  fs::write(root.0.join("library-organization.json"), r#"{"topics":[],"trash":{},"origins":{}}"#).unwrap();
  assert!(management::organization(&root.0).unwrap().custom_sections.is_empty());
  let section = LibrarySection { id: "custom-research".into(), name: " Research ".into(), topic_id: None };
  management::change(&root.0, LibraryChange::CreateSection { section: section.clone() }).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().custom_sections[0].name, "Research");
  assert!(management::change(&root.0, LibraryChange::CreateSection { section: LibrarySection { id: "custom-duplicate".into(), name: "research".into(), topic_id: None } }).is_err());
  assert!(management::change(&root.0, LibraryChange::CreateSection { section: LibrarySection { id: "diary".into(), name: "Invalid".into(), topic_id: None } }).is_err());
  let backup = user_data::capture(&root.0, BTreeMap::new(), serde_json::json!([])).unwrap();
  fs::remove_file(root.0.join("library-organization.json")).unwrap();
  user_data::restore(&root.0, &backup, "restore-sections").unwrap();
  assert_eq!(management::organization(&root.0).unwrap().custom_sections.len(), 1);
  let doc = library::publish_document(&root.0, "com.personal.diary", "Diary", document("Keep original")).unwrap();
  management::change(&root.0, LibraryChange::Place { id: doc.id.clone(), topic_id: None, section }).unwrap();
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().content, "Keep original");
  assert_eq!(management::history(&root.0, &doc.id).unwrap().len(), 1);
  management::change(&root.0, LibraryChange::Trash { ids: vec![doc.id.clone()] }).unwrap();
  management::change(&root.0, LibraryChange::Purge { ids: vec![doc.id] }).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().custom_sections.len(), 1);
}

#[test]
fn rename_and_delete_sections_keep_documents_topics_revisions_and_trash() {
  use management::LibrarySection;
  let root = Fixture::new();
  let section = LibrarySection { id: "custom-research".into(), name: "Research".into(), topic_id: None };
  management::change(&root.0, LibraryChange::CreateSection { section: section.clone() }).unwrap();
  let active = library::publish_document(&root.0, "com.personal.diary", "Diary", document("Active")).unwrap();
  let trashed = library::publish_document(&root.0, "com.personal.other", "Other", document("Trashed")).unwrap();
  for doc in [&active, &trashed] { management::change(&root.0, LibraryChange::Place { id: doc.id.clone(), topic_id: None, section: section.clone() }).unwrap(); }
  management::change(&root.0, LibraryChange::SaveTopic { topic: Topic { id: "topic".into(), name: "Topic".into(), document_ids: vec![active.id.clone()] } }).unwrap();
  management::change(&root.0, LibraryChange::Trash { ids: vec![trashed.id.clone()] }).unwrap();
  let rename = serde_json::from_value(serde_json::json!({ "kind": "rename-section", "id": section.id, "name": " Reading " })).unwrap();
  management::change(&root.0, rename).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().sections[&trashed.id].name, "Reading");
  management::change(&root.0, LibraryChange::Place { id: active.id.clone(), topic_id: None, section: section.clone() }).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().sections[&active.id].name, "Reading");
  let delete = serde_json::from_value(serde_json::json!({ "kind": "delete-section", "id": section.id })).unwrap();
  management::change(&root.0, delete).unwrap();
  let state = management::organization(&root.0).unwrap();
  assert!(state.custom_sections.is_empty());
  assert!(state.sections.is_empty());
  assert!(state.trash.contains_key(&trashed.id));
  assert_eq!(state.topics[0].document_ids, vec![active.id.clone()]);
  assert_eq!(library::read_document(&root.0, &active.id).unwrap().revision, active.revision);
  assert_eq!(management::history(&root.0, &active.id).unwrap().len(), 1);
  management::change(&root.0, LibraryChange::Restore { ids: vec![trashed.id.clone()] }).unwrap();
  assert_eq!(library::read_document(&root.0, &trashed.id).unwrap().revision, trashed.revision);
  assert!(management::change(&root.0, LibraryChange::Place { id: active.id, topic_id: None, section }).is_err());
}

#[test]
fn section_updates_validate_names_and_only_manage_existing_custom_sections() {
  use management::LibrarySection;
  let root = Fixture::new();
  for (id, name) in [("custom-research", "Research"), ("custom-reading", "Reading")] {
    management::change(&root.0, LibraryChange::CreateSection { section: LibrarySection { id: id.into(), name: name.into(), topic_id: None } }).unwrap();
  }
  let before = fs::read(root.0.join("library-organization.json")).unwrap();
  for name in [" ".to_string(), "a".repeat(81), " reading ".into()] {
    let change = serde_json::from_value(serde_json::json!({ "kind": "rename-section", "id": "custom-research", "name": name })).unwrap();
    assert!(management::change(&root.0, change).is_err());
  }
  for id in ["diary", "custom-missing"] {
    for kind in ["rename-section", "delete-section"] {
      let change = serde_json::from_value(serde_json::json!({ "kind": kind, "id": id, "name": "New" })).unwrap();
      assert!(management::change(&root.0, change).is_err());
    }
  }
  assert_eq!(fs::read(root.0.join("library-organization.json")).unwrap(), before);
  let rename = serde_json::from_value(serde_json::json!({ "kind": "rename-section", "id": "custom-research", "name": "RESEARCH" })).unwrap();
  management::change(&root.0, rename).unwrap();
  let delete = serde_json::from_value(serde_json::json!({ "kind": "delete-section", "id": "custom-reading" })).unwrap();
  management::change(&root.0, delete).unwrap();
  assert_eq!(management::organization(&root.0).unwrap().custom_sections[0].name, "RESEARCH");
  assert_eq!(management::organization(&root.0).unwrap().custom_sections.len(), 1);
}

#[test]
fn topic_sections_persist_scope_and_reject_cross_topic_placement() {
  let root = Fixture::new();
  for id in ["meta", "test"] { management::change(&root.0, LibraryChange::SaveTopic { topic: Topic { id: id.into(), name: id.into(), document_ids: vec![] } }).unwrap(); }
  let apply = |value| management::change(&root.0, serde_json::from_value(value).unwrap());
  for (id, topic) in [("custom-meta", Some("meta")), ("custom-test", Some("test")), ("custom-all", None)] {
    apply(serde_json::json!({ "kind": "create-section", "section": { "id": id, "name": "栏目1", "topicId": topic } })).unwrap();
  }
  assert!(apply(serde_json::json!({ "kind": "create-section", "section": { "id": "custom-duplicate", "name": "栏目1", "topicId": "meta" } })).is_err());
  assert!(apply(serde_json::json!({ "kind": "create-section", "section": { "id": "custom-missing", "name": "Other", "topicId": "deleted" } })).is_err());
  apply(serde_json::json!({ "kind": "rename-section", "id": "custom-test", "name": "栏目2" })).unwrap();
  apply(serde_json::json!({ "kind": "rename-section", "id": "custom-test", "name": "栏目1" })).unwrap();
  let doc = library::publish_document(&root.0, "com.personal.notes", "Notes", document("Scoped")).unwrap();
  let section = serde_json::json!({ "id": "custom-meta", "name": "栏目1" });
  assert!(apply(serde_json::json!({ "kind": "place", "id": doc.id, "topicId": "test", "section": section })).is_err());
  assert!(management::organization(&root.0).unwrap().topics[1].document_ids.is_empty());
  apply(serde_json::json!({ "kind": "place", "id": doc.id, "section": section })).unwrap();
  let state = serde_json::to_value(management::organization(&root.0).unwrap()).unwrap();
  assert_eq!(state["customSections"][0]["topicId"], "meta");
  assert_eq!(state["topics"][0]["documentIds"][0], doc.id);
  let backup = user_data::capture(&root.0, BTreeMap::new(), serde_json::json!([])).unwrap();
  fs::remove_file(root.0.join("library-organization.json")).unwrap();
  user_data::restore(&root.0, &backup, "restore-scope").unwrap();
  assert_eq!(serde_json::to_value(management::organization(&root.0).unwrap()).unwrap()["customSections"][0]["topicId"], "meta");
  apply(serde_json::json!({ "kind": "delete-topic", "id": "meta" })).unwrap();
  assert!(serde_json::to_value(management::organization(&root.0).unwrap()).unwrap()["customSections"][0]["topicId"].is_null());
  assert_eq!(library::read_document(&root.0, &doc.id).unwrap().revision, doc.revision);
}
