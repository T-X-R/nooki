use app_lib::{capability_runtime::{CapabilityManifest, CapabilityEntrypoint, CapabilityPermission, PlatformState}, document_library::DocumentPublication, document_selection};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf};

static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

struct Fixture { root: PathBuf, state: PlatformState, doc: String }
impl Fixture {
  fn new() -> Self {
    let root = std::env::temp_dir().join(format!("nooki-selection-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let state = PlatformState::load(root.clone()).unwrap();
    for id in ["example.reader", "example.other"] {
      state.install_capability(CapabilityManifest { id:id.into(), version:"0.1.0".into(), name:id.into(), description:String::new(), locales:BTreeMap::new(), entrypoints:vec![CapabilityEntrypoint::Page], permissions:vec![CapabilityPermission::DocumentsReadSelected,CapabilityPermission::DocumentsPublish], min_platform_version:"0.1.0".into() }).unwrap();
    }
    let doc = state.publish_document("example.other", DocumentPublication { key:"source".into(), title:"Selected source".into(), collection_key:"notes".into(), collection_name:"Notes".into(), document_date:"2026-11-20".into(), content:"Synthetic private input".into() }).unwrap().id;
    Self {root,state,doc}
  }
  fn begin(&self) -> Value { document_selection::begin(&self.state,"main",json!({"requestId":format!("selection-{}", NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)),"capabilityId":"example.reader","version":"0.1.0","purpose":"Draft meeting actions","limit":1})).unwrap() }
}
impl Drop for Fixture { fn drop(&mut self) { let _=fs::remove_dir_all(&self.root); } }

#[test]
fn selection_is_host_owned_bound_to_generation_and_metadata_only_until_confirmed() {
  let f=Fixture::new();
  assert!(document_selection::begin(&f.state,"package-view",json!({"requestId":"test-request","capabilityId":"example.reader","version":"0.1.0","purpose":"Read","limit":1})).is_err());
  let ticket=f.begin();
  assert!(!f.root.join("document-grants").exists());
  assert!(ticket.get("generation").is_none());
  f.state.set_capability_enabled("example.reader",false).unwrap();
  f.state.set_capability_enabled("example.reader",true).unwrap();
  let denied=document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":[f.doc]})).unwrap_err();
  assert_eq!(serde_json::to_value(denied).unwrap()["code"],"PERMISSION_DENIED");
  assert!(!f.root.join("document-grants").exists());
  document_selection::cancel(&f.state,"main",json!({"requestId":ticket["requestId"]})).unwrap();
  let ticket=f.begin();
  let request=json!({"handle":ticket["handle"],"ids":[f.doc]});
  let grant=document_selection::commit(&f.state,"main",request.clone()).unwrap();
  assert!(grant.documents[0].content.is_none());
  assert_eq!(grant.purpose.as_deref(),Some("Draft meeting actions"));
  assert!(f.state.read_selected_document("example.other",&grant.id,&f.doc).is_err());
  assert_eq!(document_selection::commit(&f.state,"main",request).unwrap().id,grant.id);
  document_selection::cancel(&f.state,"main",json!({"requestId":ticket["requestId"]})).unwrap();
  assert!(f.state.read_selected_document("example.reader",&grant.id,&f.doc).is_ok());
  document_selection::revoke(&f.state,"main",json!({"id":grant.id})).unwrap();
  assert!(f.state.read_selected_document("example.reader",&grant.id,&f.doc).is_err());
  assert!(f.state.read_document_source(&grant.id,&f.doc).is_ok());
}

#[test]
fn dismissed_cancelled_forged_and_oversized_requests_do_not_capture_content() {
  let f=Fixture::new();let ticket=f.begin();
  document_selection::cancel(&f.state,"main",json!({"requestId":ticket["requestId"]})).unwrap();
  document_selection::cancel(&f.state,"main",json!({"requestId":ticket["requestId"]})).unwrap();
  assert!(document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":[f.doc]})).is_err());
  for change in [json!({"approved":true}),json!({"limit":0}),json!({"purpose":""}),json!({"version":"foreign"})] {
    let mut request=json!({"requestId":"test-request","capabilityId":"example.reader","version":"0.1.0","purpose":"Read","limit":1});
    request.as_object_mut().unwrap().extend(change.as_object().unwrap().clone());
    assert!(document_selection::begin(&f.state,"main",request).is_err());
  }
  let ticket=f.begin();
  assert!(document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":[f.doc],"capabilityId":"example.other"})).is_err());
  assert!(document_selection::commit(&f.state,"foreign",json!({"handle":ticket["handle"],"ids":[f.doc]})).is_err());
  assert!(document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":[f.doc,"other"]})).is_err());
  assert!(!f.root.join("document-grants").exists());
  assert!(document_selection::revoke(&f.state,"foreign",json!({"id":"unknown"})).is_err());
  let restarted=PlatformState::load(f.root.clone()).unwrap();
  assert!(document_selection::commit(&restarted,"main",json!({"handle":ticket["handle"],"ids":[f.doc]})).is_err());
}

#[test]
fn lost_begin_reply_can_be_cancelled_and_identical_replay_does_not_consume_more_capacity() {
  let f=Fixture::new();
  for i in 0..32 {
    let request=json!({"requestId":format!("lost-{i}"),"capabilityId":"example.reader","version":"0.1.0","purpose":"Read","limit":1});
    let issued=document_selection::begin(&f.state,"main",request.clone()).unwrap();
    assert_eq!(document_selection::begin(&f.state,"main",request.clone()).unwrap(),issued);
    let mut changed=request; changed["purpose"]=json!("Different purpose");
    assert_eq!(serde_json::to_value(document_selection::begin(&f.state,"main",changed).unwrap_err()).unwrap()["code"],"CONFLICT");
    // Cancellation needs only the correlation retained before dispatch, not the lost native reply.
    document_selection::cancel(&f.state,"main",json!({"requestId":format!("lost-{i}")})).unwrap();
    assert!(document_selection::commit(&f.state,"main",json!({"handle":issued["handle"],"ids":[f.doc]})).is_err());
  }
  assert!(!f.root.join("document-grants").exists());
}

#[test]
fn selection_capacity_and_changed_approval_fail_before_another_capture() {
  let f=Fixture::new(); let mut tickets=Vec::new();
  for _ in 0..16 { tickets.push(f.begin()); }
  let request=json!({"requestId":"overflow","capabilityId":"example.reader","version":"0.1.0","purpose":"Read","limit":1});
  assert_eq!(serde_json::to_value(document_selection::begin(&f.state,"main",request.clone()).unwrap_err()).unwrap()["code"],"RESOURCE_LIMIT");
  document_selection::cancel(&f.state,"main",json!({"requestId":tickets[0]["requestId"]})).unwrap();
  let ticket=document_selection::begin(&f.state,"main",request).unwrap();
  document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":[f.doc]})).unwrap();
  let changed=document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":["different"]})).unwrap_err();
  assert_eq!(serde_json::to_value(changed).unwrap()["code"],"CONFLICT");
  assert_eq!(fs::read_dir(f.root.join("document-grants")).unwrap().count(),1);
}

#[test]
fn access_management_retains_inactive_and_revoked_metadata_across_restart() {
  let f=Fixture::new(); let ticket=f.begin();
  let grant=document_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"ids":[f.doc]})).unwrap();
  assert!(document_selection::accesses(&f.state,"foreign",json!({})).is_err());
  let entries=document_selection::accesses(&f.state,"main",json!({})).unwrap();
  assert_eq!(entries[0].status,"active"); assert!(entries[0].grant.documents[0].content.is_none());
  let restarted=PlatformState::load(f.root.clone()).unwrap();
  assert!(restarted.read_selected_document("example.reader",&grant.id,&f.doc).is_ok());
  restarted.set_capability_enabled("example.reader",false).unwrap();
  assert_eq!(document_selection::accesses(&restarted,"main",json!({})).unwrap()[0].status,"inactive");
  document_selection::revoke(&restarted,"main",json!({"id":grant.id})).unwrap();
  let restarted=PlatformState::load(f.root.clone()).unwrap();
  assert_eq!(document_selection::accesses(&restarted,"main",json!({})).unwrap()[0].status,"revoked");
  assert_eq!(restarted.read_document_source(&grant.id,&f.doc).unwrap().content.as_deref(),Some("Synthetic private input"));
}
