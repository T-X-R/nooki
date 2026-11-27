use super::*;
use crate::capability_runtime::CapabilityManifest;
struct Fixture {root:std::path::PathBuf,state:PlatformState}
impl Fixture {
    fn new()->Self {
        let root=std::env::temp_dir().join(format!("nooki-delegation-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.notes","name":"Notes","version":"1.0.0","description":"","entrypoints":["page"],"permissions":["board.request-delegation","documents.publish","board.attach-delivery","agents.run"],"minPlatformVersion":"0.18.0"})).unwrap();
        state.install_capability(manifest).unwrap();
        let doc=state.publish_document("example.notes",crate::document_library::DocumentPublication {key:"notes".into(),title:"Original notes".into(),collection_key:"meetings".into(),collection_name:"Meetings".into(),document_date:"2026-11-27".into(),content:"Frozen source body".into()}).unwrap();
        let mut board=json!({"cards":[{"id":"test-task","title":"Follow up","description":"Retained meeting content","sources":[{"id":doc.id,"title":doc.title}],"status":"todo","createdAt":1,"provenance":{"type":"capability","capabilityId":"example.notes","capabilityVersion":"1.0.0"}}]});
        crate::task_goals::save(&root,&mut board).unwrap();Self{root,state}
    }
    fn request(&self)->Value {json!({"requestId":"review","capabilityId":"example.notes","version":"1.0.0","key":"one","input":{"item":{"id":"test-task","revision":1}}})}
    fn begin(&self)->Value {begin(&self.state,"main",self.request()).unwrap()}
    fn commit(&self,ticket:&Value)->Result<Value,String>{commit(&self.state,"main",json!({"handle":ticket["handle"]}))}
}
impl Drop for Fixture {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.root);}}
#[test]
fn reviewed_commit_replays_and_independent_input_survives_package_removal() {
    let f=Fixture::new();let ticket=f.begin();assert_eq!(f.begin(),ticket);
    assert_eq!(crate::task_goals::load(&f.root).unwrap()["cards"][0]["status"],"todo");
    assert_eq!(inspect(&f.state,"main",json!({"handle":ticket["handle"]})).unwrap()["description"],"Retained meeting content");
    let receipt=f.commit(&ticket).unwrap();assert_eq!(f.commit(&ticket).unwrap(),receipt);
    let restarted=PlatformState::load(f.root.clone()).unwrap();assert_eq!(begin(&restarted,"main",f.request()).unwrap()["receipt"],receipt);
    let source=crate::task_goals::load(&f.root).unwrap()["cards"][0]["sources"][0]["id"].as_str().unwrap().to_owned();
    for extension in ["md","json"] {std::fs::remove_file(f.root.join("document-library").join(&source).with_extension(extension)).unwrap();}
    f.state.uninstall_capability("example.notes").unwrap();
    let board=crate::task_goals::load(&f.root).unwrap();let card=&board["cards"][0];
    assert_eq!(card["engine"],"goals");assert_eq!(card["status"],"queued");assert_eq!(board["cards"].as_array().unwrap().len(),1);
    crate::task_goals::write_brief(&f.root,card).unwrap();
    assert!(std::fs::read_to_string(f.root.join("task-inputs/test-task.md")).unwrap().contains("Retained meeting content"));
    assert_eq!(crate::source_snapshots::read(&f.root,card["authorization"]["snapshotId"].as_str().unwrap()).unwrap()[0].content,"Frozen source body");
    assert!(std::fs::read_to_string(f.root.join("task-inputs/test-task.md")).unwrap().contains("Frozen source body"));
}
#[test]
fn cancelled_changed_or_removed_proposals_cannot_queue_work() {
    let f=Fixture::new();assert!(begin(&f.state,"package",f.request()).is_err());
    let ticket=f.begin();cancel(&f.state,"main",json!({"requestId":"review"})).unwrap();assert!(f.commit(&ticket).is_err());
    let ticket=f.begin();let mut board=crate::task_goals::load(&f.root).unwrap();board["cards"][0]["description"]=json!("Changed");crate::task_goals::save(&f.root,&mut board).unwrap();
    assert!(f.commit(&ticket).unwrap_err().starts_with("CONFLICT"));assert_eq!(crate::task_goals::load(&f.root).unwrap()["cards"][0]["status"],"todo");
    f.state.uninstall_capability("example.notes").unwrap();assert!(f.commit(&ticket).unwrap_err().starts_with("PERMISSION_DENIED"));
}
#[test]
fn foreign_tasks_and_reused_keys_cannot_change_the_approved_target() {
    let f=Fixture::new();let ticket=f.begin();f.commit(&ticket).unwrap();
    let mut request=f.request();request["input"]["item"]["revision"]=json!(2);
    assert!(begin(&f.state,"main",request).unwrap_err().starts_with("CONFLICT"));
    let other=Fixture::new();let mut board=crate::task_goals::load(&other.root).unwrap();board["cards"][0]["provenance"]["capabilityId"]=json!("example.peer");crate::task_goals::save(&other.root,&mut board).unwrap();
    let mut request=other.request();request["input"]["item"]["revision"]=board["cards"][0]["revision"].clone();
    assert!(begin(&other.state,"main",request).unwrap_err().starts_with("PERMISSION_DENIED"));
}

#[test]
fn selected_task_still_requires_new_execution_review_and_original_run_must_be_terminal() {
    use crate::capability_agent_runs as runs;
    let f=Fixture::new();let mut board=crate::task_goals::load(&f.root).unwrap();board["cards"][0].as_object_mut().unwrap().remove("provenance");crate::task_goals::save(&f.root,&mut board).unwrap();
    let item=json!({"id":"test-task","revision":board["cards"][0]["revision"]});
    let selection=crate::task_selection::begin(&f.state,"main",json!({"requestId":"select","capabilityId":"example.notes","version":"1.0.0","purpose":"Propose follow-up","operations":["attachDelivery"],"limit":1})).unwrap();
    let grant=crate::task_selection::commit(&f.state,"main",json!({"handle":selection["handle"],"items":[item]})).unwrap();
    let mut request=f.request();request["input"]=json!({"item":item,"grantId":grant["id"]});
    let scope=runs::Scope{installation:context(&f.root,"example.notes").unwrap(),restore_id:None};
    let intent:runs::Intent=serde_json::from_value(json!({"instructions":"Original work","sources":[],"agentId":"codex","policyDigest":"b".repeat(64),"component":{"protocolRevision":2,"sha256":"c".repeat(64)},"outputSchema":null})).unwrap();
    let run=runs::approve(&f.root,&scope,"original",&intent,||Ok(()),||Ok(vec![])).unwrap();request["input"]["sourceRunId"]=json!(run.id);
    assert!(begin(&f.state,"main",request.clone()).unwrap_err().starts_with("CONFLICT"));
    runs::cancel_unsubmitted(&f.root,&scope,&run.id,||Ok(())).unwrap();
    let ticket=begin(&f.state,"main",request).unwrap();assert_eq!(crate::task_goals::load(&f.root).unwrap()["cards"][0]["status"],"todo");
    f.commit(&ticket).unwrap();assert_eq!(crate::task_goals::load(&f.root).unwrap()["cards"][0]["engine"],"goals");
}
