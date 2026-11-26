use app_lib::{conversation_handoffs::{self as drafts, ApprovedDraft, Target}, document_grants::{DocumentReference, SelectedDocument}, user_data};
use serde_json::json;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut nonce=[0u8;16];getrandom::fill(&mut nonce).unwrap();
        let path = std::env::temp_dir().join(format!("nooki-handoff-{:x?}", nonce));
        fs::create_dir_all(&path).unwrap(); Self(path)
    }
    fn commit(&self, key: &str, input: &ApprovedDraft) -> Result<drafts::Receipt, String> {
        drafts::commit_approved(&self.0, "example.reader", "1.0.0", key, input, || Ok(()), || Ok(vec![source()]))
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn reference() -> DocumentReference {
    DocumentReference { kind:"library-document".into(), document_id:"example.reader/notes/2026/11/original".into(), title:"Selected notes".into(), grant_id:"synthetic-grant".into(), revision:"v1".into() }
}
fn source() -> SelectedDocument { SelectedDocument { reference:reference(), document_date:"2026-11-26".into(), content:Some("Original selected text".into()) } }
fn input() -> ApprovedDraft { ApprovedDraft { title:"Review notes".into(), text:"Please review these notes.".into(), target:Target::New, sources:vec![reference()] } }

#[test]
fn exact_replay_survives_restart_without_recapturing_sources_or_creating_a_session() {
    let f=Fixture::new(); let receipt=f.commit("one",&input()).unwrap();
    let before=fs::read(f.0.join("conversation-handoffs.json")).unwrap();
    let replay=drafts::commit_approved(&f.0,"example.reader","1.0.1","one",&input(),|| Ok(()),|| panic!("committed source must not be recaptured")).unwrap();
    assert_eq!(replay,receipt);
    assert_eq!(fs::read(f.0.join("conversation-handoffs.json")).unwrap(),before);
    let retained=drafts::read(&f.0,&receipt.draft_id).unwrap();
    assert_eq!(retained.documents[0].content.as_deref(),Some("Original selected text"));
    assert_eq!(retained.capability_version,"1.0.0");
    assert_eq!(fs::read_dir(&f.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|name| name != "task-data.lock" && name != "capability-authority.lock").collect::<Vec<_>>(),vec!["conversation-handoffs.json"]);
}
#[test]
fn key_changes_are_conflicts_and_capabilities_have_independent_receipts() {
    let f=Fixture::new(); let first=f.commit("same",&input()).unwrap();
    for changed in [ApprovedDraft { text:"Changed".into(),..input() }, ApprovedDraft { target:Target::Conversation { id:"other-native-thread".into() },..input() }, ApprovedDraft { sources:vec![],..input() }] {
        assert!(f.commit("same",&changed).unwrap_err().starts_with("CONFLICT"));
    }
    let peer=drafts::commit_approved(&f.0,"example.peer","1.0.0","same",&input(),|| Ok(()),|| Ok(vec![source()])).unwrap();
    assert_ne!(peer,first); assert_eq!(drafts::list(&f.0).unwrap().len(),2);
}
#[test]
fn failed_capture_and_failed_write_leave_no_receipt_and_exact_retry_commits_once() {
    let f=Fixture::new();
    assert!(drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&input(),|| Ok(()),|| Err("PERMISSION_DENIED: source revoked".into())).is_err());
    assert!(drafts::list(&f.0).unwrap().is_empty());
    fs::create_dir(f.0.join("conversation-handoffs.pending")).unwrap();
    assert!(f.commit("one",&input()).is_err()); assert!(drafts::list(&f.0).unwrap().is_empty());
    fs::remove_dir(f.0.join("conversation-handoffs.pending")).unwrap();
    let receipt=f.commit("one",&input()).unwrap();assert_eq!(f.commit("one",&input()).unwrap(),receipt);
    assert_eq!(drafts::list(&f.0).unwrap().len(),1);
}
#[test]
fn capture_must_match_the_approved_references_and_contain_text() {
    let f=Fixture::new();
    for docs in [vec![],vec![SelectedDocument { content:None,..source() }],vec![SelectedDocument { reference:DocumentReference { revision:"v2".into(),..reference() },..source() }]] {
        assert!(drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&input(),|| Ok(()),|| Ok(docs)).is_err());
    }
    assert!(drafts::list(&f.0).unwrap().is_empty());
}
#[test]
fn source_free_drafts_preserve_target_and_other_drafts() {
    let f=Fixture::new();let original=f.commit("one",&input()).unwrap();
    let offer=ApprovedDraft { sources:vec![],target:Target::Conversation { id:"native-thread".into() },..input() };
    let receipt=drafts::commit_approved(&f.0,"example.reader","1.0.0","two",&offer,|| Ok(()),|| Ok(vec![])).unwrap();
    assert_eq!(receipt.target,offer.target);
    assert_eq!(drafts::read(&f.0,&original.draft_id).unwrap().text,input().text);
    assert_eq!(drafts::list(&f.0).unwrap().len(),2);
}
#[test]
fn malformed_or_oversized_input_fails_before_capture() {
    let f=Fixture::new();
    for offer in [ApprovedDraft { title:" ".into(),..input() },ApprovedDraft { text:"x".repeat(20_001),..input() },ApprovedDraft { sources:vec![reference(),reference()],..input() },ApprovedDraft { target:Target::Conversation { id:"".into() },..input() }] {
        assert!(drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&offer,|| Ok(()),|| panic!("invalid offer reached capture")).is_err());
    }
    let too_large=SelectedDocument { content:Some("x".repeat(8_000_001)),..source() };
    assert!(drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&input(),|| Ok(()),|| Ok(vec![too_large])).is_err());
    assert!(drafts::list(&f.0).unwrap().is_empty());
}
#[test]
fn backup_restore_retains_user_owned_drafts_and_rejects_corrupt_receipts() {
    let f=Fixture::new();let receipt=f.commit("one",&input()).unwrap();
    let backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    assert!(backup.files.contains_key("conversation-handoffs.json"));
    let restored=Fixture::new();user_data::restore(&restored.0,&backup,"handoff-restore").unwrap();
    assert_eq!(drafts::read(&restored.0,&receipt.draft_id).unwrap().documents[0].content,source().content);
    assert_eq!(restored.commit("one",&input()).unwrap(),receipt);
    let mut invalid=backup.clone();let mut ledger:serde_json::Value=serde_json::from_str(&invalid.files["conversation-handoffs.json"]).unwrap();
    ledger["receipts"].as_object_mut().unwrap().values_mut().next().unwrap()["result"]["draftId"]=json!("forged");
    invalid.files.insert("conversation-handoffs.json".into(),ledger.to_string());
    assert!(user_data::validate(&invalid).is_err());
}
#[test]
fn malformed_disk_state_is_not_silently_replaced() {
    let f=Fixture::new();fs::write(f.0.join("conversation-handoffs.json"),"{}").unwrap();
    assert!(f.commit("one",&input()).is_err());
    assert_eq!(fs::read_to_string(f.0.join("conversation-handoffs.json")).unwrap(),"{}");
}


#[test]
fn authorization_is_required_even_on_replay_and_failure_leaves_the_store_unchanged() {
    let f=Fixture::new();
    assert!(drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&input(),|| Err("PERMISSION_DENIED: approval withdrawn".into()),|| panic!("denied capture")).is_err());
    assert!(drafts::list(&f.0).unwrap().is_empty());
    f.commit("one",&input()).unwrap();let before=fs::read(f.0.join("conversation-handoffs.json")).unwrap();
    assert!(drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&input(),|| Err("PERMISSION_DENIED: installation removed".into()),|| panic!("replay capture")).is_err());
    assert_eq!(fs::read(f.0.join("conversation-handoffs.json")).unwrap(),before);
}
#[test]
fn concurrent_effects_cannot_enter_between_authorization_and_commit() {
    let f=Fixture::new();let root=f.0.clone();
    let (entered,wait)=std::sync::mpsc::channel();let (release,continue_commit)=std::sync::mpsc::channel();
    let worker=std::thread::spawn(move || drafts::commit_approved(&root,"example.reader","1.0.0","one",&input(),|| { entered.send(()).unwrap();continue_commit.recv().unwrap();Ok(()) },|| Ok(vec![source()])));
    wait.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
    let blocked=f.commit("one",&input());release.send(()).unwrap();let first=worker.join().unwrap().unwrap();
    assert!(blocked.unwrap_err().starts_with("RESOURCE_BUSY"));assert_eq!(f.commit("one",&input()).unwrap(),first);
    assert_eq!(drafts::list(&f.0).unwrap().len(),1);
}

#[test]
fn retained_draft_survives_native_source_deletion_and_package_uninstall() {
    use app_lib::{capability_runtime::{PlatformState, CapabilityManifest}, document_library::DocumentPublication, library_management::{self, LibraryChange}};
    let f=Fixture::new();let state=PlatformState::load(f.0.clone()).unwrap();
    let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.reader","name":"Synthetic reader","version":"1.0.0","description":"","entrypoints":["page"],"permissions":["documents.publish","documents.read-selected"],"minPlatformVersion":"0.3.0"})).unwrap();
    state.install_capability(manifest).unwrap();
    let doc=state.publish_document("example.reader",DocumentPublication { key:"original".into(),title:"Selected notes".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-26".into(),content:"Original selected text".into() }).unwrap();
    state.grant_documents("example.reader",vec![doc.id.clone()],"retained-source").unwrap();
    let selected=state.read_selected_document("example.reader","retained-source",&doc.id).unwrap();
    let offer=ApprovedDraft { sources:vec![selected.reference.clone()],..input() };
    // This tests storage retention with actual native Library data. C05b owns effect-time approval.
    let receipt=drafts::commit_approved(&f.0,"example.reader","1.0.0","one",&offer,|| Ok(()),|| Ok(vec![selected])).unwrap();
    library_management::change(&f.0,LibraryChange::DeleteDocuments { ids:vec![doc.id] }).unwrap();
    state.uninstall_capability("example.reader").unwrap();
    let restarted=PlatformState::load(f.0.clone()).unwrap();
    assert!(restarted.list_capabilities().unwrap().is_empty());
    assert_eq!(drafts::read(&f.0,&receipt.draft_id).unwrap().documents[0].content.as_deref(),Some("Original selected text"));
}
