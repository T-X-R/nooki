use app_lib::{capability_runtime::{CapabilityManifest,PlatformState}, conversation_handoff_host as host,
    conversation_handoffs::{self as drafts,ApprovedDraft,Target}, conversation_documents::{self,DocumentInputs},
    document_library::{self,DocumentPublication}, library_management::{self,LibraryChange},source_snapshots,user_data};
use serde_json::{json,Value};
use std::{fs,path::PathBuf};
struct Fixture {root:PathBuf,state:PlatformState,document:String,draft:String}
impl Fixture {
    fn new()->Self {
        let mut bytes=[0u8;16];getrandom::fill(&mut bytes).unwrap();let root=std::env::temp_dir().join(format!("nooki-handoff-sources-{:x?}",bytes));
        let state=PlatformState::load(root.clone()).unwrap();let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.reader","name":"Reader","version":"1.0.0","description":"","entrypoints":["page"],"permissions":["documents.publish","documents.read-selected"],"minPlatformVersion":"0.3.0"})).unwrap();state.install_capability(manifest).unwrap();
        let doc=state.publish_document("example.reader",publication("original","Retained original")).unwrap();
        state.grant_documents("example.reader",vec![doc.id.clone()],"original-selection").unwrap();let selected=state.read_selected_document("example.reader","original-selection",&doc.id).unwrap();
        let input=ApprovedDraft{title:"Review".into(),text:"Please review".into(),target:Target::New,sources:vec![selected.reference.clone()]};
        let receipt=drafts::commit_approved(&root,"example.reader","1.0.0","offer",&input,||Ok(()),||Ok(vec![selected])).unwrap();
        Self{root,state,document:doc.id,draft:receipt.draft_id}
    }
    fn request(&self,ids:Vec<String>)->Value {json!({"draftId":self.draft,"snapshotId":"manual-send","documentIds":ids})}
    fn sources(&self,ids:Vec<String>)->Value {host::sources(&self.state,"main",self.request(ids)).unwrap()}
}
impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}
fn publication(key:&str,content:&str)->DocumentPublication {DocumentPublication{key:key.into(),title:key.into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-26".into(),content:content.into()}}
fn inputs(id:&str)->DocumentInputs {DocumentInputs{snapshot_id:Some(id.into()),..Default::default()}}

#[test]
fn deleted_original_and_removed_producer_still_supply_exact_native_working_text() {
    let f=Fixture::new();library_management::change(&f.root,LibraryChange::DeleteDocuments{ids:vec![f.document.clone()]}).unwrap();f.state.uninstall_capability("example.reader").unwrap();
    assert!(document_library::read_document(&f.root,&f.document).is_err());let captured=f.sources(vec![]);let snapshot="manual-send";
    assert_eq!(captured[0]["content"],"Retained original");assert_eq!(captured[0]["reference"]["handoffId"],f.draft);
    assert!(!f.root.join("conversation-workspaces").exists(),"capturing sources must not create a session or working directory");
    let context=conversation_documents::prepare(&f.root,"chat","request",&inputs(snapshot)).unwrap();assert!(context.contains(&f.draft));
    let path=conversation_documents::workspace(&f.root,"chat");let files=fs::read_dir(path).unwrap().collect::<Result<Vec<_>,_>>().unwrap();assert_eq!(files.len(),1);assert_eq!(fs::read_to_string(files[0].path()).unwrap(),"Retained original");
    assert_eq!(source_snapshots::source(&f.root,snapshot,&f.document).unwrap().content,"Retained original");
}
#[test]
fn additional_sources_are_captured_once_and_changed_selection_cannot_reuse_snapshot() {
    let f=Fixture::new();let extra=f.state.publish_document("example.reader",publication("extra","Extra before deletion")).unwrap();let first=f.sources(vec![extra.id.clone()]);
    library_management::change(&f.root,LibraryChange::DeleteDocuments{ids:vec![extra.id.clone()]}).unwrap();assert_eq!(f.sources(vec![extra.id]),first);
    assert!(host::sources(&f.state,"main",f.request(vec![])).unwrap_err().starts_with("CONFLICT"));
    assert!(host::sources(&f.state,"main",f.request(vec![f.document.clone()])).is_err());
}
#[test]
fn retained_sources_do_not_replace_earlier_working_edits_or_current_document_versions() {
    let f=Fixture::new();source_snapshots::capture(&f.root,"ordinary",&[f.document.clone()]).unwrap();conversation_documents::prepare(&f.root,"chat","ordinary-turn",&inputs("ordinary")).unwrap();
    let dir=conversation_documents::workspace(&f.root,"chat");let ordinary=fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();fs::write(&ordinary,"Existing user edits").unwrap();
    f.sources(vec![]);let snapshot="manual-send";conversation_documents::prepare(&f.root,"chat","offered-turn",&inputs(snapshot)).unwrap();
    let handoff=fs::read_dir(&dir).unwrap().map(|e|e.unwrap().path()).find(|p|p!=&ordinary).unwrap();assert_eq!(fs::read_to_string(&ordinary).unwrap(),"Existing user edits");assert_eq!(fs::read_to_string(&handoff).unwrap(),"Retained original");
    fs::write(&handoff,"Edited offered working copy").unwrap();conversation_documents::prepare(&f.root,"chat","later-turn",&inputs(snapshot)).unwrap();assert_eq!(fs::read_to_string(handoff).unwrap(),"Edited offered working copy");
}
#[test]
fn host_binding_rejects_foreign_callers_unknown_fields_and_invalid_inputs_before_capture() {
    let f=Fixture::new();assert!(host::sources(&f.state,"package",f.request(vec![])).unwrap_err().starts_with("PERMISSION_DENIED"));
    let mut forged=f.request(vec![]);forged["documents"]=json!([{"content":"injected"}]);assert!(host::sources(&f.state,"main",forged).is_err());
    let mut invalid=f.request(vec![]);invalid["snapshotId"]=json!("../outside");assert!(host::sources(&f.state,"main",invalid).is_err());
    let mut missing=f.request(vec![]);missing["draftId"]=json!("a".repeat(64));assert!(host::sources(&f.state,"main",missing).is_err());
    assert!(!f.root.join("source-snapshots").exists());
}
#[test]
fn snapshot_replay_and_citations_survive_backup_restore_and_refuse_corrupt_retained_text() {
    let f=Fixture::new();let captured=f.sources(vec![]);let id="manual-send";let backup=user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    let restored=Fixture::new();user_data::restore(&restored.root,&backup,"restore-handoff-sources").unwrap();assert_eq!(host::sources(&restored.state,"main",f.request(vec![])).unwrap(),captured);
    assert_eq!(source_snapshots::source(&restored.root,id,&f.document).unwrap().content,"Retained original");
    let mut corrupt=captured.clone();corrupt[0]["content"]=json!("Changed on disk");fs::write(f.root.join("source-snapshots").join(format!("{id}.json")),corrupt.to_string()).unwrap();
    assert!(host::sources(&f.state,"main",f.request(vec![])).unwrap_err().starts_with("CONFLICT"));
}

#[test]
fn source_capacity_data_lock_and_failed_snapshot_write_fail_without_partial_outputs() {
    let f=Fixture::new();
    let ids=(0..50).map(|i|format!("example.reader/notes/2026/11/extra-{i}")).collect::<Vec<_>>();
    assert!(host::sources(&f.state,"main",f.request(ids)).is_err());assert!(!f.root.join("source-snapshots").exists());
    use std::os::fd::AsRawFd;
    let lock=fs::OpenOptions::new().read(true).write(true).open(f.root.join("task-data.lock")).unwrap();
    assert_eq!(unsafe {libc::flock(lock.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)},0);
    assert!(host::sources(&f.state,"main",f.request(vec![])).unwrap_err().starts_with("RESOURCE_BUSY"));drop(lock);
    fs::create_dir(f.root.join("source-snapshots")).unwrap();fs::create_dir(f.root.join("source-snapshots/manual-send.pending")).unwrap();
    assert!(host::sources(&f.state,"main",f.request(vec![])).is_err());assert!(!f.root.join("source-snapshots/manual-send.json").exists());
    fs::remove_dir(f.root.join("source-snapshots/manual-send.pending")).unwrap();assert_eq!(f.sources(vec![])[0]["content"],"Retained original");
}
