#![cfg(unix)]
use app_lib::{capability_runtime::{CapabilityEntrypoint, CapabilityManifest, PlatformState}, task_goals::GoalWorker};
use serde_json::{json,Value};
use std::{collections::BTreeMap, fs, path::{Path,PathBuf}, sync::atomic::{AtomicU64,Ordering}};

fn fixture() -> (PathBuf,PlatformState,GoalWorker,String) {
    static NEXT:AtomicU64=AtomicU64::new(0);
    let root=std::env::temp_dir().join(format!("nooki-board-create-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));
    let state=PlatformState::load(root.clone()).unwrap();
    state.install_capability(CapabilityManifest {id:"example.notes".into(),version:"0.1.0".into(),name:"Notes".into(),description:String::new(),locales:BTreeMap::new(),entrypoints:vec![CapabilityEntrypoint::Page],permissions:vec![],min_platform_version:"0.1.0".into()}).unwrap();
    let handle=state.grant_board_creation("native-a","example.notes","0.1.0").unwrap();
    let worker=GoalWorker::new(root.clone(),"/missing-agent-must-not-start".into());
    (root,state,worker,handle)
}
fn request(handle:&str,key:&str)->Value {json!({"op":"capability-create","caller":"native-a","handle":handle,"key":key,"input":{"title":"Review minutes","description":"Prepare next steps"}})}
fn disk(root:&Path)->Value {serde_json::from_slice(&fs::read(root.join("task-board.json")).unwrap()).unwrap()}
async fn command(worker:&mut GoalWorker,request:Value)->Result<Value,String> {
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(3);
    loop {
        match worker.command(request.clone()).await {
            Err(error) if error=="Task data maintenance is in progress" => {
                assert!(std::time::Instant::now()<deadline,"task-data lock did not become available");
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            result=>return result,
        }
    }
}

#[tokio::test]
async fn creation_and_receipt_commit_together_without_starting_an_agent() {
    let (root,_state,mut worker,handle)=fixture();
    let result=command(&mut worker,request(&handle,"one")).await.unwrap();
    let board=disk(&root);
    assert_eq!(board["cards"].as_array().unwrap().len(),1);
    let card=&board["cards"][0]; assert_eq!(card["id"],result["id"]); assert_eq!(result["revision"],1);
    assert_eq!(card["status"],"todo"); assert_eq!(card["title"],"Review minutes");
    assert_eq!(card["provenance"]["capabilityId"],"example.notes");
    for field in ["authorization","threadId","runId","execution","engine","queuedAt"] {assert!(card.get(field).is_none());}
    assert_eq!(board["capabilityReceipts"].as_object().unwrap().len(),1);
    assert!(!fs::read_to_string(root.join("task-board.json")).unwrap().contains(&handle));
    worker.tick().await.unwrap(); assert_eq!(disk(&root),board);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn canonical_replay_survives_restart_and_item_deletion_without_recreation() {
    let (root,state,mut worker,handle)=fixture();
    let result=command(&mut worker,request(&handle,"same")).await.unwrap();
    let mut equivalent=request(&handle,"same");equivalent["input"]["sources"]=json!([]);
    assert_eq!(command(&mut worker,equivalent).await.unwrap(),result);
    let before=fs::read(root.join("task-board.json")).unwrap();
    let mut changed=request(&handle,"same");changed["input"]["description"]=json!("Changed");
    assert!(command(&mut worker,changed).await.unwrap_err().contains("CONFLICT"));
    assert_eq!(fs::read(root.join("task-board.json")).unwrap(),before);
    drop(worker);drop(state);
    let state=PlatformState::load(root.clone()).unwrap();let mut worker=GoalWorker::new(root.clone(),"/missing-agent".into());
    assert!(command(&mut worker,request(&handle,"same")).await.unwrap_err().contains("PERMISSION_DENIED"));
    let fresh=state.grant_board_creation("native-a","example.notes","0.1.0").unwrap();
    assert_eq!(command(&mut worker,request(&fresh,"same")).await.unwrap(),result);
    let mut deleted=disk(&root);deleted["cards"]=json!([]);deleted["capabilityReceipts"]=json!({"forged":"ignored"});
    command(&mut worker,json!({"op":"legacy","board":deleted})).await.unwrap();
    assert!(disk(&root)["cards"].as_array().unwrap().is_empty());
    assert_eq!(command(&mut worker,request(&fresh,"same")).await.unwrap(),result);
    assert!(disk(&root)["cards"].as_array().unwrap().is_empty());
    assert_eq!(disk(&root)["capabilityReceipts"].as_object().unwrap().len(),1);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn stale_full_board_saves_cannot_erase_new_items_or_forge_provenance() {
    let (root,_state,mut worker,handle)=fixture();
    let stale=command(&mut worker,json!({"op":"read"})).await.unwrap();
    command(&mut worker,request(&handle,"one")).await.unwrap();let current=disk(&root);
    assert!(command(&mut worker,json!({"op":"legacy","board":stale})).await.unwrap_err().contains("CONFLICT"));
    assert_eq!(disk(&root),current);
    let mut edited=current.clone();edited["cards"][0]["title"]=json!("User edited");
    edited["cards"][0]["provenance"]=json!({"capabilityId":"forged"});edited["cards"][0]["revision"]=json!(999);
    let saved=command(&mut worker,json!({"op":"legacy","board":edited})).await.unwrap();
    assert_eq!(saved["cards"][0]["title"],"User edited");assert_eq!(saved["cards"][0]["revision"],2);
    assert_eq!(saved["cards"][0]["provenance"],current["cards"][0]["provenance"]);
    assert_ne!(saved["writeToken"],current["writeToken"]);
    assert_eq!(saved["capabilityReceipts"],current["capabilityReceipts"]);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn failed_precommit_writes_leave_neither_item_nor_receipt() {
    let (root,_state,mut worker,handle)=fixture();
    fs::create_dir(root.join("task-board.pending")).unwrap();
    assert!(command(&mut worker,request(&handle,"retry")).await.is_err());
    assert!(!root.join("task-board.json").exists());
    fs::remove_dir(root.join("task-board.pending")).unwrap();
    let result=command(&mut worker,request(&handle,"retry")).await.unwrap();
    assert_eq!(disk(&root)["cards"][0]["id"],result["id"]);
    assert_eq!(disk(&root)["capabilityReceipts"].as_object().unwrap().len(),1);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn current_authority_is_required_even_for_receipt_replay() {
    let (root,state,mut worker,handle)=fixture();
    command(&mut worker,request(&handle,"one")).await.unwrap();let before=disk(&root);
    let mut wrong=request(&handle,"other");wrong["caller"]=json!("native-b");
    assert!(command(&mut worker,wrong).await.unwrap_err().contains("PERMISSION_DENIED"));
    state.revoke_board_invocation("native-a",&handle).unwrap();
    for key in ["one","other"] {assert!(command(&mut worker,request(&handle,key)).await.unwrap_err().contains("PERMISSION_DENIED"));}
    assert_eq!(disk(&root),before);fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn unknown_fields_and_unapproved_sources_are_not_silently_accepted() {
    let (root,_state,mut worker,handle)=fixture();
    for (field,value) in [("title",json!("")),("description",json!("x".repeat(20_001))),("description",json!("😀".repeat(20_000))),("sources",json!([{"id":"unselected","title":"secret"}])),("status",json!("queued")),("capabilityId",json!("forged"))] {
        let mut invalid=request(&handle,"invalid");invalid["input"][field]=value;
        assert!(command(&mut worker,invalid).await.is_err());assert!(!root.join("task-board.json").exists());
    }
    let mut invalid=request(&handle,"invalid");invalid["scope"]=json!("board");assert!(command(&mut worker,invalid).await.is_err());
    command(&mut worker,request(&handle,"valid")).await.unwrap();fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn postrename_failure_reports_unknown_and_retry_reads_the_committed_receipt() {
    use std::os::unix::fs::PermissionsExt;
    struct Restore(PathBuf);
    impl Drop for Restore {fn drop(&mut self) {let _=fs::set_permissions(&self.0,fs::Permissions::from_mode(0o700));}}
    let (root,_state,mut worker,handle)=fixture();let restore=Restore(root.clone());
    // Search/write remain allowed, but opening the directory for durability acknowledgement fails.
    fs::set_permissions(&root,fs::Permissions::from_mode(0o300)).unwrap();
    assert!(fs::File::open(&root).is_err(),"fault injection requires directory read denial");
    let error=command(&mut worker,request(&handle,"uncertain")).await.unwrap_err();
    let replay_error=command(&mut worker,request(&handle,"uncertain")).await.unwrap_err();
    drop(restore);assert!(error.contains("OUTCOME_UNKNOWN"),"{error}");
    assert!(replay_error.contains("OUTCOME_UNKNOWN"),"replay must not acknowledge unconfirmed durability: {replay_error}");
    let committed=disk(&root);assert_eq!(committed["cards"].as_array().unwrap().len(),1);
    let result=command(&mut worker,request(&handle,"uncertain")).await.unwrap();
    assert_eq!(result["id"],committed["cards"][0]["id"]);assert_eq!(disk(&root),committed);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn receipt_scope_capacity_and_backup_validation_preserve_existing_outcomes() {
    let (root,state,mut worker,handle)=fixture();let original=command(&mut worker,request(&handle,"same")).await.unwrap();
    let mut peer=state.list_capabilities().unwrap()[0].manifest.clone();peer.id="example.peer".into();state.install_capability(peer).unwrap();
    let peer_handle=state.grant_board_creation("native-b","example.peer","0.1.0").unwrap();
    let mut peer_request=request(&peer_handle,"same");peer_request["caller"]=json!("native-b");
    let other=command(&mut worker,peer_request).await.unwrap();assert_ne!(other["id"],original["id"]);
    let backup=app_lib::user_data::capture(&root,BTreeMap::new(),json!([])).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&backup.files["task-board.json"]).unwrap(),disk(&root));
    // Build a retained, structurally valid ledger at the documented per-package limit.
    let mut board=disk(&root);let sample=board["capabilityReceipts"].as_object().unwrap().values().find(|r|r["capabilityId"]=="example.notes").unwrap().clone();
    for index in 0..255 {let mut receipt=sample.clone();receipt["result"]["id"]=json!(format!("{index:064x}"));board["capabilityReceipts"][format!("{index:064x}")]=receipt;}
    fs::write(root.join("task-board.json"),serde_json::to_vec(&board).unwrap()).unwrap();
    let before=fs::read(root.join("task-board.json")).unwrap();
    assert!(command(&mut worker,request(&handle,"over-limit")).await.unwrap_err().contains("RESOURCE_LIMIT"));
    assert_eq!(command(&mut worker,request(&handle,"same")).await.unwrap(),original);
    assert_eq!(fs::read(root.join("task-board.json")).unwrap(),before);
    // Reach the aggregate limit with retained receipts from other, possibly uninstalled packages.
    for index in 255..1022 {
        let mut receipt=sample.clone();receipt["capabilityId"]=json!(format!("example.retained{}",(index-255)/256));
        receipt["result"]["id"]=json!(format!("{index:064x}"));board["capabilityReceipts"][format!("{index:064x}")]=receipt;
    }
    assert_eq!(board["capabilityReceipts"].as_object().unwrap().len(),1024);
    fs::write(root.join("task-board.json"),serde_json::to_vec(&board).unwrap()).unwrap();
    let before=fs::read(root.join("task-board.json")).unwrap();
    let mut peer_request=request(&peer_handle,"over-global-limit");peer_request["caller"]=json!("native-b");
    assert!(command(&mut worker,peer_request).await.unwrap_err().contains("RESOURCE_LIMIT"));
    assert_eq!(command(&mut worker,request(&handle,"same")).await.unwrap(),original);
    assert_eq!(fs::read(root.join("task-board.json")).unwrap(),before);
    let mut corrupt=backup.clone();let mut corrupt_board:Value=serde_json::from_str(&corrupt.files["task-board.json"]).unwrap();
    let first=corrupt_board["capabilityReceipts"].as_object_mut().unwrap().values_mut().next().unwrap();first["payloadHash"]=json!("bad");
    corrupt.files.insert("task-board.json".into(),corrupt_board.to_string());assert!(app_lib::user_data::validate(&corrupt).is_err());
    let first=corrupt_board["capabilityReceipts"].as_object_mut().unwrap().values_mut().next().unwrap();first["extra"]=json!("x".repeat(1024*1024));
    corrupt.files.insert("task-board.json".into(),corrupt_board.to_string());
    assert!(app_lib::user_data::validate(&corrupt).unwrap_err().contains("RESOURCE_LIMIT"));
    fs::remove_dir_all(root).unwrap();
}

struct NativeWorker(std::process::Child);
impl NativeWorker {
    async fn start(root:&Path)->Self {
        let mut worker=Self(std::process::Command::new(env!("CARGO_BIN_EXE_app")).arg("--task-worker").arg(root)
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
            .stderr(fs::File::create(root.join("test-worker.log")).unwrap()).spawn().unwrap());
        tokio::time::timeout(std::time::Duration::from_secs(10),async {
            loop {
                assert!(worker.0.try_wait().unwrap().is_none(),"native worker exited before readiness");
                if tokio::net::UnixStream::connect(root.join("task-worker.sock")).await.is_ok() {break;}
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.unwrap();worker
    }
}
impl Drop for NativeWorker {fn drop(&mut self) {let _=self.0.kill();let _=self.0.wait();}}

#[tokio::test]
async fn actual_worker_replays_concurrent_calls_and_lost_replies_after_worker_restart() {
    use tokio::io::AsyncWriteExt;
    let (root,_state,worker,handle)=fixture();drop(worker);
    let native=NativeWorker::start(&root).await;
    let call=request(&handle,"concurrent");
    let (a,b,c)=tokio::join!(app_lib::task_worker::request(&root,call.clone()),app_lib::task_worker::request(&root,call.clone()),app_lib::task_worker::request(&root,call));
    let result=a.unwrap();assert_eq!(b.unwrap(),result);assert_eq!(c.unwrap(),result);
    assert_eq!(disk(&root)["cards"].as_array().unwrap().len(),1);
    let mut stream=tokio::net::UnixStream::connect(root.join("task-worker.sock")).await.unwrap();
    stream.write_all(format!("{}\n",request(&handle,"lost-reply")).as_bytes()).await.unwrap();drop(stream);
    tokio::time::timeout(std::time::Duration::from_secs(5),async {
        while disk(&root)["cards"].as_array().unwrap().len()!=2 {tokio::time::sleep(std::time::Duration::from_millis(10)).await;}
    }).await.unwrap();
    let committed=disk(&root);drop(native); // Child exit is reaped before a replacement starts.
    let native=NativeWorker::start(&root).await;
    let result=app_lib::task_worker::request(&root,request(&handle,"lost-reply")).await.unwrap();
    assert_eq!(result["id"],committed["cards"][1]["id"]);assert_eq!(disk(&root),committed);
    assert!(app_lib::task_worker::renderer_request(&root,request(&handle,"escape")).await.unwrap_err().contains("PERMISSION_DENIED"));
    assert!(app_lib::task_worker::renderer_request(&root,json!({"op":"handoff"})).await.is_err());
    assert_eq!(app_lib::task_worker::renderer_request(&root,json!({"op":"read"})).await.unwrap(),committed);
    drop(native);fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn queued_native_request_is_rechecked_after_revocation_before_writing() {
    use tokio::io::{AsyncBufReadExt,AsyncWriteExt,BufReader};
    let (root,state,worker,handle)=fixture();drop(worker);let native=NativeWorker::start(&root).await;
    // The first connection deliberately withholds its newline, keeping the single worker busy.
    let mut blocker=tokio::net::UnixStream::connect(root.join("task-worker.sock")).await.unwrap();
    blocker.write_all(b"{\"op\":\"read\"").await.unwrap();
    let mut queued=tokio::net::UnixStream::connect(root.join("task-worker.sock")).await.unwrap();
    queued.write_all(format!("{}\n",request(&handle,"late")).as_bytes()).await.unwrap();
    state.revoke_board_invocation("native-a",&handle).unwrap();drop(blocker);
    let mut response=String::new();tokio::time::timeout(std::time::Duration::from_secs(5),BufReader::new(queued).read_line(&mut response)).await.unwrap().unwrap();
    let response:Value=serde_json::from_str(&response).unwrap();
    assert!(response["error"].as_str().unwrap().contains("PERMISSION_DENIED"));
    assert!(!root.join("task-board.json").exists());drop(native);fs::remove_dir_all(root).unwrap();
}
