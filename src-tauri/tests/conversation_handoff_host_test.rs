use app_lib::{capability_runtime::{CapabilityManifest,PlatformState}, conversation_handoff_host as host, conversation_handoff_selection as review, conversation_handoffs as drafts, conversation_host::ConversationHost, codex_conversations::ConversationAction};
use serde_json::{json,Value};
use std::{fs,path::PathBuf,sync::Arc};
// Parallel process-launch fixtures intermittently observe RESOURCE_BUSY in another fixture's
// short native transactions. Isolate fixture lifetimes; join! below still tests in-flight races.
static FIXTURE:std::sync::Mutex<()>=std::sync::Mutex::new(());
struct Fixture {root:PathBuf,state:PlatformState,bridge:ConversationHost,_guard:std::sync::MutexGuard<'static,()>}
impl Fixture {
    fn new()->Self {
        let guard=FIXTURE.lock().unwrap_or_else(|error|error.into_inner());
        let mut random=[0u8;16];getrandom::fill(&mut random).unwrap();let root=PathBuf::from("/private/tmp").join(format!("nooki-handoff-host-{}",random.iter().map(|b|format!("{b:02x}")).collect::<String>()));
        let state=PlatformState::load(root.clone()).unwrap();let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.reader","name":"Reader","version":"1.0.0","description":"","entrypoints":["page"],"permissions":["conversations.handoff"],"minPlatformVersion":"0.10.0"})).unwrap();state.install_capability(manifest).unwrap();
        let bridge=ConversationHost::new(root.join("missing-agent").to_string_lossy().into(),root.clone(),Arc::new(|_|{}));Self{root,state,bridge,_guard:guard}
    }
    fn begin(&self,id:&str)->Value { review::begin(&self.state,"main",json!({"requestId":id,"capabilityId":"example.reader","version":"1.0.0","key":id,"draft":{"title":"Review","text":"Synthetic draft","sources":[]}})).unwrap() }
    fn request(&self,ticket:&Value,target:Value)->Value {json!({"handle":ticket["handle"],"target":target})}
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(pid)=fs::read_to_string(self.root.join("conversation-workspace/fake-daemon.pid")).ok().and_then(|s|s.parse::<i32>().ok()).filter(|pid|*pid>1) {
            // This unique fixture root records only the deterministic daemon this test launched.
            unsafe {libc::kill(pid,libc::SIGTERM);}
        }
        let _=fs::remove_dir_all(&self.root);
    }
}
#[tokio::test]
async fn new_draft_and_replay_need_no_agent_or_conversation_lookup() {
    let f=Fixture::new();let ticket=f.begin("new");let request=f.request(&ticket,json!({"kind":"new"}));
    let receipt=host::commit(&f.state,&f.bridge,"main",request.clone()).await.unwrap();
    assert_eq!(host::commit(&f.state,&f.bridge,"main",request).await.unwrap(),receipt);
    assert!(!f.root.join("conversation-workspace").exists());assert!(!f.root.join("conversation-agents.json").exists());assert!(!f.root.join("tasks.json").exists());
}
#[tokio::test]
async fn actual_native_catalog_targets_are_metadata_only_and_revalidated() {
    let f=Fixture::new();let thread=f.bridge.create("pi").await.unwrap();let id=thread["id"].as_str().unwrap();let ticket=f.begin("existing");
    let page=host::targets(&f.state,&f.bridge,"main",json!({"handle":ticket["handle"]})).await.unwrap();
    assert_eq!(page["data"][0]["id"],id);assert_eq!(page["data"][0].as_object().unwrap().len(),2);assert!(page["data"][0].get("turns").is_none());
    f.bridge.change(id,ConversationAction::Archive).await.unwrap();let request=f.request(&ticket,json!({"kind":"conversation","id":id}));
    assert!(host::commit(&f.state,&f.bridge,"main",request.clone()).await.is_err());assert!(drafts::list(&f.root).unwrap().is_empty());
    f.bridge.change(id,ConversationAction::Restore).await.unwrap();let receipt=host::commit(&f.state,&f.bridge,"main",request.clone()).await.unwrap();
    f.bridge.change(id,ConversationAction::Archive).await.unwrap();f.bridge.change(id,ConversationAction::Delete).await.unwrap();
    assert_eq!(host::commit(&f.state,&f.bridge,"main",request).await.unwrap(),receipt);
    assert_eq!(host::read(&f.state,"main",json!({"id":receipt["draftId"]})).unwrap()["text"],"Synthetic draft");
}
#[tokio::test]
async fn unauthorized_and_dismissed_reviews_fail_before_discovery_or_reads() {
    let f=Fixture::new();let ticket=f.begin("cancel");let request=f.request(&ticket,json!({"kind":"conversation","id":"unknown"}));
    assert!(host::targets(&f.state,&f.bridge,"package",json!({"handle":ticket["handle"]})).await.is_err());
    assert!(host::commit(&f.state,&f.bridge,"package",request.clone()).await.is_err());
    assert!(host::read(&f.state,"package",json!({"id":"unknown"})).is_err());assert!(host::list(&f.state,"package",json!({})).is_err());
    review::cancel(&f.state,"main",json!({"requestId":"cancel"})).unwrap();
    assert!(host::targets(&f.state,&f.bridge,"main",json!({"handle":ticket["handle"]})).await.is_err());assert!(host::commit(&f.state,&f.bridge,"main",request).await.is_err());
    assert!(!f.root.join("conversation-workspace").exists());
}
#[tokio::test]
async fn task_owned_conversations_cannot_become_handoff_targets() {
    let f=Fixture::new();let thread=f.bridge.create("pi").await.unwrap();let id=thread["id"].as_str().unwrap();
    fs::write(f.root.join("task-board.json"),json!({"cards":[{"id":"synthetic-task","title":"Task","description":"Synthetic","status":"todo","engine":"goals","threadId":id}]}).to_string()).unwrap();
    let ticket=f.begin("task");let page=host::targets(&f.state,&f.bridge,"main",json!({"handle":ticket["handle"]})).await.unwrap();assert!(page["data"].as_array().unwrap().is_empty());
    assert!(host::commit(&f.state,&f.bridge,"main",f.request(&ticket,json!({"kind":"conversation","id":id}))).await.is_err());assert!(drafts::list(&f.root).unwrap().is_empty());
}
#[tokio::test]
async fn host_reads_preserve_user_owned_offers_after_producer_removal() {
    let f=Fixture::new();let ticket=f.begin("retained");let receipt=host::commit(&f.state,&f.bridge,"main",f.request(&ticket,json!({"kind":"new"}))).await.unwrap();
    f.state.uninstall_capability("example.reader").unwrap();let list=host::list(&f.state,"main",json!({})).unwrap();assert_eq!(list[0]["id"],receipt["draftId"]);assert!(list[0].get("documents").is_none());assert!(list[0].get("text").is_none());
    assert_eq!(host::read(&f.state,"main",json!({"id":receipt["draftId"]})).unwrap()["text"],"Synthetic draft");
}

impl Fixture {
    fn protocol(&mut self,pages:Value) {
        use std::os::unix::fs::PermissionsExt;
        let script=self.root.join("fake-codex");fs::write(&script,include_str!("fixtures/fake_codex.py")).unwrap();fs::set_permissions(&script,fs::Permissions::from_mode(0o700)).unwrap();
        fs::create_dir_all(self.root.join("conversation-workspace")).unwrap();fs::write(self.root.join("conversation-workspace/fake-list-pages.json"),pages.to_string()).unwrap();
        self.bridge=ConversationHost::new(script.to_string_lossy().into(),self.root.clone(),Arc::new(|_|{}));
    }
    async fn entered(&self) {
        tokio::time::timeout(std::time::Duration::from_secs(5),async{while !self.root.join("conversation-workspace/fake-list-entered").exists(){tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
    }
    fn release(&self) {fs::remove_file(self.root.join("conversation-workspace/fake-list-wait")).unwrap();}
    fn methods(&self)->Vec<String> {
        fs::read_to_string(self.root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line|serde_json::from_str::<Value>(line).unwrap()["method"].as_str().unwrap_or("").into()).collect()
    }
}
#[tokio::test]
async fn codex_target_pages_are_reused_without_reading_history_or_starting_turns() {
    let mut f=Fixture::new();f.protocol(json!({"first":{"data":[{"id":"first","preview":"First","turns":["private history"]}],"nextCursor":"page-two"},"page-two":{"data":[{"id":"selected","name":"Chosen","turns":["more private history"]}],"nextCursor":null}}));
    let ticket=f.begin("paged");let page=host::targets(&f.state,&f.bridge,"main",json!({"handle":ticket["handle"],"cursor":"page-two"})).await.unwrap();assert_eq!(page["data"],json!([{"id":"selected","title":"Chosen"}]));
    let receipt=host::commit(&f.state,&f.bridge,"main",f.request(&ticket,json!({"kind":"conversation","id":"selected"}))).await.unwrap();assert_eq!(receipt["target"]["id"],"selected");
    assert!(f.methods().iter().all(|m|["initialize","initialized","thread/list"].contains(&m.as_str())));
}
#[tokio::test]
async fn delayed_discovery_cannot_return_to_a_dismissed_review() {
    let mut f=Fixture::new();f.protocol(json!({"first":{"data":[],"nextCursor":null}}));fs::write(f.root.join("conversation-workspace/fake-list-wait"),"").unwrap();let ticket=f.begin("cancelled");
    let (result,())=tokio::join!(host::targets(&f.state,&f.bridge,"main",json!({"handle":ticket["handle"]})),async{f.entered().await;review::cancel(&f.state,"main",json!({"requestId":"cancelled"})).unwrap();f.release();});
    assert!(result.unwrap_err().starts_with("PERMISSION_DENIED"));assert!(drafts::list(&f.root).unwrap().is_empty());
}
#[tokio::test]
async fn target_freezes_before_async_validation_and_disable_blocks_the_late_commit() {
    let mut f=Fixture::new();f.protocol(json!({"first":{"data":[{"id":"selected","name":"Chosen"}],"nextCursor":null}}));fs::write(f.root.join("conversation-workspace/fake-list-wait"),"").unwrap();let ticket=f.begin("delayed");
    let request=f.request(&ticket,json!({"kind":"conversation","id":"selected"}));
    let (result,())=tokio::join!(host::commit(&f.state,&f.bridge,"main",request),async{
        f.entered().await;
        assert!(host::commit(&f.state,&f.bridge,"main",f.request(&ticket,json!({"kind":"new"}))).await.unwrap_err().starts_with("CONFLICT"));
        f.state.set_capability_enabled("example.reader",false).unwrap();f.release();
    });
    assert!(result.unwrap_err().starts_with("PERMISSION_DENIED"));assert!(drafts::list(&f.root).unwrap().is_empty());
}
#[tokio::test]
async fn broken_or_partial_catalogs_do_not_claim_a_target_is_missing() {
    let mut f=Fixture::new();f.bridge.create("pi").await.unwrap();let ticket=f.begin("partial");
    assert!(host::commit(&f.state,&f.bridge,"main",f.request(&ticket,json!({"kind":"conversation","id":"unknown-codex"}))).await.unwrap_err().starts_with("RESOURCE_UNAVAILABLE"));
    f.protocol(json!({"first":{"data":[],"nextCursor":"again"},"again":{"data":[],"nextCursor":"again"}}));let ticket=f.begin("cycle");
    assert!(host::commit(&f.state,&f.bridge,"main",f.request(&ticket,json!({"kind":"conversation","id":"missing"}))).await.unwrap_err().starts_with("RESOURCE_UNAVAILABLE"));assert!(drafts::list(&f.root).unwrap().is_empty());
}
