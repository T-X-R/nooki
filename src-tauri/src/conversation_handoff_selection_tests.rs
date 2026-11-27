use super::*;
use crate::{capability_runtime::CapabilityManifest, document_library::DocumentPublication, user_data};
use serde_json::json;
use std::{fs, path::PathBuf};
struct Fixture { root:PathBuf,state:PlatformState }
impl Fixture {
    fn new() -> Self {
        let root=std::env::temp_dir().join(format!("nooki-handoff-selection-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        for id in ["example.reader","example.peer"] {
            let manifest:CapabilityManifest=serde_json::from_value(json!({"id":id,"name":id,"version":"1.0.0","description":"","entrypoints":["page"],"permissions":["conversations.handoff","documents.publish","documents.read-selected"],"minPlatformVersion":"0.11.0"})).unwrap();
            state.install_capability(manifest).unwrap();
        }
        Self {root,state}
    }
    fn request(&self, request_id:&str,key:&str) -> Value { json!({"requestId":request_id,"capabilityId":"example.reader","version":"1.0.0","key":key,"draft":{"title":"Review notes","text":"Please review these notes.","sources":[]}}) }
    fn begin(&self,id:&str,key:&str) -> Value { begin(&self.state,"main",self.request(id,key)).unwrap() }
    fn approved(&self,ticket:&Value) -> Value { json!({"handle":ticket["handle"],"target":{"kind":"new"}}) }
    fn commit(&self,ticket:&Value) -> Value { commit(&self.state,"main",self.approved(ticket), |_|Ok(())).unwrap() }
    fn source(&self) -> crate::document_grants::DocumentReference {
        let doc=self.state.publish_document("example.reader",DocumentPublication {key:"original".into(),title:"Selected notes".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-26".into(),content:"Original selected text".into()}).unwrap();
        self.state.grant_documents("example.reader",vec![doc.id.clone()],"handoff-source").unwrap().documents.remove(0).reference
    }
}
impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}
#[test]
fn host_only_proposal_approval_and_exact_restart_replay_do_not_send() {
    let f=Fixture::new();
    assert!(begin(&f.state,"package",f.request("foreign","key")).unwrap_err().starts_with("PERMISSION_DENIED"));
    let ticket=f.begin("approved","key");assert_eq!(ticket,f.begin("approved","key"));
    assert!(crate::conversation_handoffs::list(&f.root).unwrap().is_empty());
    assert!(commit(&f.state,"package",f.approved(&ticket), |_|Ok(())).is_err());
    let receipt=f.commit(&ticket);assert_eq!(f.commit(&ticket),receipt);
    let restarted=PlatformState::load(f.root.clone()).unwrap();
    let replay=begin(&restarted,"main",f.request("after-restart","key")).unwrap();
    assert_eq!(replay["status"],"committed");assert_eq!(replay["receipt"],receipt);
    assert_eq!(crate::conversation_handoffs::list(&f.root).unwrap().len(),1);
    assert!(!f.root.join("conversation-agents.json").exists());assert!(!f.root.join("tasks.json").exists());
}
#[test]
fn dismissal_and_unavailable_target_have_no_effect_and_retry_target_is_frozen() {
    let f=Fixture::new();let dismissed=f.begin("dismissed","one");cancel(&f.state,"main",json!({"requestId":"dismissed"})).unwrap();
    assert!(commit(&f.state,"main",f.approved(&dismissed), |_|Ok(())).is_err());
    let ticket=f.begin("approved","two");let chosen=json!({"handle":ticket["handle"],"target":{"kind":"conversation","id":"native-thread"}});
    assert!(commit(&f.state,"main",chosen.clone(), |_|Err("NOT_FOUND: target removed".into())).is_err());
    assert!(crate::conversation_handoffs::list(&f.root).unwrap().is_empty());
    assert!(commit(&f.state,"main",f.approved(&ticket), |_|Ok(())).unwrap_err().starts_with("CONFLICT"));
    let receipt=commit(&f.state,"main",chosen.clone(),|t|{assert_eq!(t,&Target::Conversation{id:"native-thread".into()});Ok(())}).unwrap();
    assert_eq!(commit(&f.state,"main",chosen, |_|panic!("committed target is not revalidated")).unwrap(),receipt);
}
#[test]
fn changed_proposals_and_targets_cannot_reuse_a_key_or_request_identity() {
    let f=Fixture::new();let ticket=f.begin("approved","key");
    let mut changed=f.request("approved","key");changed["draft"]["text"]=json!("Other text");
    assert!(begin(&f.state,"main",changed.clone()).unwrap_err().starts_with("CONFLICT"));
    f.commit(&ticket);changed["requestId"]=json!("changed");
    assert!(begin(&f.state,"main",changed).unwrap_err().starts_with("CONFLICT"));
    assert!(commit(&f.state,"main",json!({"handle":ticket["handle"],"target":{"kind":"conversation","id":"other"}}), |_|Ok(())).unwrap_err().starts_with("CONFLICT"));
}
#[test]
fn selected_source_ownership_and_revocation_are_checked_at_effect_time() {
    let f=Fixture::new();let source=f.source();let mut request=f.request("reader","reader");request["draft"]["sources"]=json!([source]);
    let reader=begin(&f.state,"main",request.clone()).unwrap();
    request["capabilityId"]=json!("example.peer");request["requestId"]=json!("peer");request["key"]=json!("peer");
    let peer=begin(&f.state,"main",request).unwrap();
    assert!(commit(&f.state,"main",f.approved(&peer), |_|Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
    f.state.revoke_document_grant("handoff-source").unwrap();
    assert!(commit(&f.state,"main",f.approved(&reader), |_|Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
    assert!(crate::conversation_handoffs::list(&f.root).unwrap().is_empty());
}
#[test]
fn committed_selected_text_survives_revocation_and_replay_ignores_source_liveness() {
    let f=Fixture::new();let mut request=f.request("selected","key");request["draft"]["sources"]=json!([f.source()]);
    let ticket=begin(&f.state,"main",request.clone()).unwrap();let receipt=f.commit(&ticket);
    f.state.revoke_document_grant("handoff-source").unwrap();
    request["requestId"]=json!("retry");assert_eq!(begin(&f.state,"main",request).unwrap()["receipt"],receipt);
    let draft=crate::conversation_handoffs::read(&f.root,receipt["draftId"].as_str().unwrap()).unwrap();
    assert_eq!(draft.documents[0].content.as_deref(),Some("Original selected text"));
}
#[test]
fn pending_approval_is_invalidated_by_lifecycle_and_restore() {
    let f=Fixture::new();let old=f.begin("old","one");f.state.set_capability_enabled("example.reader",false).unwrap();f.state.set_capability_enabled("example.reader",true).unwrap();
    assert!(commit(&f.state,"main",f.approved(&old), |_|Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
    let ticket=f.begin("restore","two");let backup=user_data::capture(&f.root,Default::default(),json!([])).unwrap();user_data::restore(&f.root,&backup,"handoff-test-restore").unwrap();
    assert!(commit(&f.state,"main",f.approved(&ticket), |_|Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
    assert!(crate::conversation_handoffs::list(&f.root).unwrap().is_empty());
}
#[test]
fn failed_write_and_repeated_unknown_attempt_keep_one_frozen_approval() {
    let f=Fixture::new();let ticket=f.begin("approved","key");fs::create_dir(f.root.join("conversation-handoffs.pending")).unwrap();
    assert!(commit(&f.state,"main",f.approved(&ticket), |_|Ok(())).is_err());
    assert!(commit(&f.state,"main",json!({"handle":ticket["handle"],"target":{"kind":"conversation","id":"other"}}), |_|Ok(())).unwrap_err().starts_with("CONFLICT"));
    fs::remove_dir(f.root.join("conversation-handoffs.pending")).unwrap();let receipt=f.commit(&ticket);assert_eq!(f.commit(&ticket),receipt);
}
#[test]
fn permission_version_malformed_scope_and_expiry_fail_closed() {
    let f=Fixture::new();let mut manifest=f.state.list_capabilities().unwrap()[0].manifest.clone();manifest.permissions.retain(|p| *p!=CapabilityPermission::ConversationsHandoff);f.state.update_capability(manifest).unwrap();
    assert!(begin(&f.state,"main",f.request("missing","key")).unwrap_err().starts_with("PERMISSION_DENIED"));
    let mut request=f.request("bad","key");request["capabilityId"]=json!("example.peer");request["draft"]["target"]=json!({"kind":"conversation","id":"ungranted"});assert!(begin(&f.state,"main",request).is_err());
    let mut request=f.request("expired","key");request["capabilityId"]=json!("example.peer");let ticket=begin(&f.state,"main",request).unwrap();
    f.state.handoff_selections.lock().unwrap().get_mut(ticket["handle"].as_str().unwrap()).unwrap().expires_at=Instant::now();
    assert!(commit(&f.state,"main",f.approved(&ticket), |_|Ok(())).is_err());
    let mut manifest=f.state.list_capabilities().unwrap()[1].manifest.clone();manifest.min_platform_version="0.9.0".into();assert!(f.state.update_capability(manifest).is_err());
}
#[test]
fn concurrent_reviews_bind_one_receipt_and_correlation_cannot_switch_to_another_committed_key() {
    let f=Fixture::new();let first=f.begin("first","one");let second=f.begin("second","one");
    let receipt=f.commit(&first);
    assert!(commit(&f.state,"main",json!({"handle":second["handle"],"target":{"kind":"conversation","id":"other"}}), |_|Ok(())).unwrap_err().starts_with("CONFLICT"));
    let other=f.begin("other","two");f.commit(&other);
    assert!(begin(&f.state,"main",f.request("first","two")).unwrap_err().starts_with("CONFLICT"));
    assert_eq!(begin(&f.state,"main",f.request("fresh","one")).unwrap()["receipt"],receipt);
}
#[test]
fn bounded_reviews_release_capacity_and_disabled_packages_cannot_lookup_receipts() {
    let f=Fixture::new();let committed=f.begin("committed","committed");f.commit(&committed);
    cancel(&f.state,"main",json!({"requestId":"committed"})).unwrap();
    for index in 0..16 {f.begin(&format!("pending-{index}"),&format!("key-{index}"));}
    assert!(begin(&f.state,"main",f.request("overflow","extra")).unwrap_err().starts_with("RESOURCE_LIMIT"));
    cancel(&f.state,"main",json!({"requestId":"pending-0"})).unwrap();f.begin("replacement","extra");
    let mut wrong_version=f.request("version","new");wrong_version["version"]=json!("2.0.0");assert!(begin(&f.state,"main",wrong_version).unwrap_err().starts_with("PERMISSION_DENIED"));
    f.state.set_capability_enabled("example.reader",false).unwrap();
    assert!(begin(&f.state,"main",f.request("replay","committed")).unwrap_err().starts_with("PERMISSION_DENIED"));
    assert_eq!(crate::conversation_handoffs::list(&f.root).unwrap().len(),1);
}
