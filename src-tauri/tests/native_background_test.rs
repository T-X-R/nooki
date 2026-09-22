#![cfg(unix)]
use app_lib::{conversation_host::{ConversationHost, ConversationRequest}, conversation_documents::DocumentInputs, skill_pool::SkillPool};
use serde_json::Value;
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use tokio_util::sync::CancellationToken;

struct Fixture { root: PathBuf, agent: String, events: Arc<Mutex<Vec<Value>>> }
impl Fixture {
    fn new(agent: &str, label: &str) -> Self {
        let root = PathBuf::from(format!("/private/tmp/nooki-background-{agent}-{label}-{}",std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".local/bin")).unwrap();
        let script = include_str!("fixtures/fake_native.py").replace("FIXTURE_ROOT", &root.to_string_lossy()).replace("AGENT_NAME", agent);
        let binary = root.join(format!(".local/bin/{agent}"));
        fs::write(&binary, script).unwrap();
        fs::set_permissions(binary, fs::Permissions::from_mode(0o700)).unwrap();
        Self {root,agent:agent.into(),events:Arc::new(Mutex::new(Vec::new()))}
    }
    fn host(&self) -> Arc<ConversationHost> {
        let events = self.events.clone();
        Arc::new(ConversationHost::new("/missing-codex".into(),self.root.join("data"),Arc::new(move |event| events.lock().unwrap().push(event)))
            .with_worker_executable(PathBuf::from(env!("CARGO_BIN_EXE_app"))))
    }
    fn pool(&self) -> SkillPool { SkillPool::new(self.root.clone(),self.root.join("data")) }
    async fn until(&self, name: &str) {
        tokio::time::timeout(Duration::from_secs(10), async { while !self.root.join(name).exists() { tokio::time::sleep(Duration::from_millis(20)).await; } }).await.unwrap();
    }
    fn prompts(&self) -> usize { fs::read_to_string(self.root.join("prompts")).unwrap().lines().count() }
    fn pid(&self) -> i32 { fs::read_to_string(self.root.join("pid")).unwrap().parse().unwrap() }
    async fn stopped(&self) {
        tokio::time::timeout(Duration::from_secs(10), async { while unsafe { libc::kill(self.pid(),0) } == 0 { tokio::time::sleep(Duration::from_millis(20)).await; } }).await.unwrap();
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }
fn request(thread: &str, id: &str) -> ConversationRequest { ConversationRequest {thread_id:thread.into(),request_id:id.into(),message:"write a document".into(),context:String::new(),documents:DocumentInputs::default(),skills:vec![]} }

#[tokio::test]
async fn both_agents_survive_detached_observers_and_finish_once() {
    for agent in ["claude","pi"] {
        for finish_offline in [false,true] {
            let f = Fixture::new(agent, if finish_offline {"offline"} else {"reconnect"});
            let host = f.host();
            let thread = host.create(&f.agent).await.unwrap()["id"].as_str().unwrap().to_string();
            let running = host.clone(); let pool = f.pool(); let input = request(&thread,"original");
            let observer = tokio::spawn(async move { running.run(&input,&pool,CancellationToken::new()).await });
            f.until("pid").await;
            // pi emits a tool-turn boundary before this point; it must still be running.
            observer.abort(); let _ = observer.await; drop(host);
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert_eq!(unsafe { libc::kill(f.pid(),0) },0);
            assert_eq!(f.prompts(),1);
            let reopened = f.host();
            assert!(reopened.run(&request(&thread,"must-not-overlap"),&f.pool(),CancellationToken::new()).await.is_err());
            if finish_offline {
                fs::write(f.root.join("finish"),"").unwrap();
                tokio::time::timeout(Duration::from_secs(10), async {
                    while reopened.read(&thread,None).await.unwrap()["turns"][0]["status"] != "completed" {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                }).await.unwrap();
            }
            let view = reopened.read(&thread,None).await.unwrap();
            assert_eq!(view["turns"].as_array().unwrap().len(),1);
            assert_eq!(view["turns"][0]["status"],if finish_offline {"completed"} else {"inProgress"});
            let reconnect = reopened.clone(); let id = thread.clone();
            let observer = tokio::spawn(async move { reconnect.reconnect(&id,"original",CancellationToken::new()).await });
            fs::write(f.root.join("finish"),"").unwrap();
            let result = tokio::time::timeout(Duration::from_secs(10),observer).await.unwrap().unwrap().unwrap();
            assert_eq!(result["turnId"],"original");
            assert!(!result["artifacts"].as_array().unwrap().is_empty());
            // Repeating the run RPC with the same intent also only reconnects.
            reopened.run(&request(&thread,"original"),&f.pool(),CancellationToken::new()).await.unwrap();
            assert_eq!(f.prompts(),1);
            let view = reopened.read(&thread,None).await.unwrap();
            assert_eq!(view["turns"][0]["status"],"completed");
            assert_eq!(view["turns"][0]["items"][1]["text"],"finished document");
            assert!(f.events.lock().unwrap().iter().any(|event| event["method"] == "turn/completed"));
            f.stopped().await;
        }
    }
}

#[tokio::test]
async fn explicit_stop_cancels_original_worker_and_reconnect_never_restarts_it() {
    for agent in ["claude","pi"] {
        let f = Fixture::new(agent,"cancel"); let host=f.host();
        let thread=host.create(agent).await.unwrap()["id"].as_str().unwrap().to_string();
        let input=request(&thread,"stop-me");let running=host.clone();let pool=f.pool();
        let token=CancellationToken::new();let cancel=token.clone();
        let observer=tokio::spawn(async move {running.run(&input,&pool,cancel).await});
        f.until("pid").await; token.cancel();
        assert!(tokio::time::timeout(Duration::from_secs(10),observer).await.unwrap().unwrap().is_err());
        f.stopped().await;
        assert!(f.host().reconnect(&thread,"stop-me",CancellationToken::new()).await.is_err());
        assert_eq!(f.prompts(),1);
    }
}

#[tokio::test]
async fn unknown_claude_failure_is_not_automatically_submitted_twice() {
    let f=Fixture::new("claude","failure");fs::write(f.root.join("fail"),"").unwrap();
    let host=f.host();let thread=host.create("claude").await.unwrap()["id"].as_str().unwrap().to_string();
    assert!(host.run(&request(&thread,"failed-once"),&f.pool(),CancellationToken::new()).await.is_err());
    assert_eq!(f.prompts(),1);
}

/// Opt-in because these two small prompts use the person's real CLI account.
#[tokio::test]
#[ignore]
async fn live_native_clis_finish_after_the_ui_observer_is_dropped() {
    let selection = std::env::var("NOOKI_LIVE_AGENT").ok();
    for agent in ["claude", "pi"].into_iter().filter(|agent| selection.is_none() || selection.as_deref() == Some(*agent)) {
        let f = Fixture::new(agent,"live");
        let host = f.host();
        let thread = host.create(agent).await.unwrap()["id"].as_str().unwrap().to_string();
        let pool = SkillPool::from_environment(f.root.join("data")).unwrap();
        let input = ConversationRequest { message: "Create background.md in the current directory with exactly the text 'Nooki background execution verified'. Reply briefly when done. This is a synthetic test; do not read other files or access the network.".into(), ..request(&thread,"live-original") };
        let running = host.clone();
        let observer = tokio::spawn(async move { running.run(&input,&pool,CancellationToken::new()).await });
        let ready = f.root.join("data/native-runs").join(&thread).join("live-original/ready");
        tokio::time::timeout(Duration::from_secs(10), async { while !ready.exists() { tokio::time::sleep(Duration::from_millis(20)).await; } }).await.unwrap();
        observer.abort(); let _ = observer.await; drop(host);
        // No foreground host or observer is attached while the CLI executes.
        let state_path = ready.with_file_name("state.json");
        let state = tokio::time::timeout(Duration::from_secs(180), async { loop {
            let state: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
            if state["turn"]["status"] != "inProgress" { break state; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }}).await.unwrap();
        assert_eq!(state["turn"]["status"],"completed","{agent}: {}",state["error"]);
        let result = f.host().reconnect(&thread,"live-original",CancellationToken::new()).await.unwrap();
        assert!(!result["artifacts"].as_array().unwrap().is_empty(),"{agent} must produce the requested file");
        assert_eq!(f.host().read(&thread,None).await.unwrap()["turns"].as_array().unwrap().len(),1);
        println!("{agent}: completed offline, recovered original turn and artifact");
    }
}
