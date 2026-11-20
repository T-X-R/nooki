#![cfg(unix)]
use app_lib::{capability_runtime::{CapabilityEntrypoint, CapabilityManifest, CapabilityPermission, PlatformState}, task_goals::GoalWorker};
use serde_json::{json,Value};
use std::{collections::BTreeMap, fs, path::{Path,PathBuf}, sync::atomic::{AtomicU64,Ordering}};

fn fixture() -> (PathBuf,PlatformState,GoalWorker,String) {
    static NEXT:AtomicU64=AtomicU64::new(0);
    let root=std::env::temp_dir().join(format!("nooki-board-create-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));
    let state=PlatformState::load(root.clone()).unwrap();
    state.install_capability(CapabilityManifest {id:"example.notes".into(),version:"0.1.0".into(),name:"Notes".into(),description:String::new(),locales:BTreeMap::new(),entrypoints:vec![CapabilityEntrypoint::Page],permissions:vec![CapabilityPermission::BoardCreate],min_platform_version:"0.1.0".into()}).unwrap();
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
async fn host_adapter_binds_native_caller_and_rejects_package_selected_authority() {
    use app_lib::capability_host::board_create;
    let (root,state,worker,handle)=fixture();drop(worker);
    let native=NativeWorker::start(&root).await;
    let request=json!({"handle":handle,"key":"host-create","input":{"title":"Host request"}});
    for field in ["caller","capabilityId","generation","permissions","op","resource"] {
        let mut forged=request.clone();forged[field]=json!("native-a");
        let error=board_create(&state,"native-a",forged).await.unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["code"],"INVALID_INPUT");
    }
    let denied=board_create(&state,"native-b",request.clone()).await.unwrap_err();
    assert_eq!(serde_json::to_value(denied).unwrap()["code"],"PERMISSION_DENIED");
    assert!(!root.join("task-board.json").exists());
    let result=board_create(&state,"native-a",request.clone()).await.unwrap();
    assert_eq!(board_create(&state,"native-a",request.clone()).await.unwrap(),result);
    assert_eq!(disk(&root)["cards"].as_array().unwrap().len(),1);
    assert_eq!(disk(&root)["cards"][0]["provenance"]["capabilityId"],"example.notes");
    let mut changed=request.clone();changed["input"]["title"]=json!("Different");
    assert_eq!(serde_json::to_value(board_create(&state,"native-a",changed).await.unwrap_err()).unwrap()["code"],"CONFLICT");
    state.set_capability_enabled("example.notes",false).unwrap();
    assert_eq!(serde_json::to_value(board_create(&state,"native-a",request).await.unwrap_err()).unwrap()["code"],"PERMISSION_DENIED");
    drop(native);fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn host_adapter_refuses_invalid_payloads_before_contacting_the_worker() {
    use app_lib::capability_host::board_create;
    let (root,state,worker,handle)=fixture();drop(worker); // No worker is started for invalid input.
    for input in [json!({"title":""}),json!({"title":"OK","authorization":{}}),json!({"title":"OK","description":"🎵".repeat(20_000)})] {
        let request=json!({"handle":handle,"key":"invalid","input":input});
        let error=board_create(&state,"native-a",request).await.unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["code"],"INVALID_INPUT");
    }
    assert!(!root.join("task-worker.sock").exists());assert!(!root.join("task-board.json").exists());
    fs::remove_dir_all(root).unwrap();
}

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

fn source_fixture() -> (PathBuf,PlatformState,GoalWorker,String,Value) {
    let (root,state,worker,_)=fixture();
    let mut manifest=state.list_capabilities().unwrap()[0].manifest.clone();
    manifest.permissions.extend([CapabilityPermission::DocumentsReadSelected,CapabilityPermission::DocumentsPublish]);
    state.update_capability(manifest.clone()).unwrap();
    manifest.id="example.other".into();state.install_capability(manifest).unwrap();
    let document=state.publish_document("example.notes",app_lib::document_library::DocumentPublication {key:"minutes".into(),title:"Selected minutes".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-20".into(),content:"Original selected input".into()}).unwrap();
    let grant=state.grant_documents("example.notes",vec![document.id],"selected").unwrap();
    let handle=state.grant_board_creation("native-a","example.notes","0.1.0").unwrap();
    (root,state,worker,handle,serde_json::to_value(&grant.documents[0].reference).unwrap())
}
fn sourced(handle:&str,key:&str,reference:Value)->Value {
    let mut value=request(handle,key);value["input"]["sources"]=json!([reference]);value
}

#[tokio::test]
async fn selected_sources_commit_with_canonical_references_without_execution_authority() {
    let (root,state,mut worker,handle,reference)=source_fixture();
    let result=command(&mut worker,sourced(&handle,"selected",reference.clone())).await.unwrap();
    let board=disk(&root);let card=&board["cards"][0];
    assert_eq!(card["sources"],json!([{"id":reference["documentId"],"title":reference["title"],"reference":reference}]));
    assert_eq!(card["id"],result["id"]);assert_eq!(card["status"],"todo");
    for field in ["authorization","threadId","runId","execution","engine","delivery"] {assert!(card.get(field).is_none());}
    assert!(!fs::read_to_string(root.join("task-board.json")).unwrap().contains("Original selected input"));
    state.publish_document("example.notes",app_lib::document_library::DocumentPublication {key:"minutes".into(),title:"Edited title".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-20".into(),content:"Changed original".into()}).unwrap();
    worker.tick().await.unwrap();assert_eq!(disk(&root),board);
    drop(worker);drop(state);
    let state=PlatformState::load(root.clone()).unwrap();let mut worker=GoalWorker::new(root.clone(),"/missing-agent".into());
    let fresh=state.grant_board_creation("native-a","example.notes","0.1.0").unwrap();
    assert_eq!(command(&mut worker,sourced(&fresh,"selected",reference.clone())).await.unwrap(),result);
    assert_eq!(state.read_document_source("selected",reference["documentId"].as_str().unwrap()).unwrap().content.as_deref(),Some("Original selected input"));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn unselected_foreign_revoked_and_forged_references_leave_no_card_or_receipt() {
    let (root,state,mut worker,handle,reference)=source_fixture();
    let foreign=state.grant_documents("example.other",vec![reference["documentId"].as_str().unwrap().into()],"foreign").unwrap();
    let mut cases=vec![serde_json::to_value(&foreign.documents[0].reference).unwrap()];
    for (field,value) in [("documentId","example.notes/notes/2026/11/unselected"),("revision","forged"),("title","Misleading title"),("kind","artifact"),("grantId","missing")] {
        let mut changed=reference.clone();changed[field]=json!(value);cases.push(changed);
    }
    let mut unknown=reference.clone();unknown["capabilityId"]=json!("example.notes");cases.push(unknown);
    for value in cases {
        assert!(command(&mut worker,sourced(&handle,"denied",value)).await.is_err());
        assert!(!root.join("task-board.json").exists());
    }
    state.revoke_document_grant("selected").unwrap();
    assert!(command(&mut worker,sourced(&handle,"revoked",reference)).await.unwrap_err().contains("PERMISSION_DENIED"));
    assert!(!root.join("task-board.json").exists());fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn source_revocation_blocks_new_effects_but_not_metadata_only_receipt_replay() {
    let (root,state,mut worker,handle,reference)=source_fixture();
    let result=command(&mut worker,sourced(&handle,"committed",reference.clone())).await.unwrap();
    state.revoke_document_grant("selected").unwrap();let before=disk(&root);
    assert_eq!(command(&mut worker,sourced(&handle,"committed",reference.clone())).await.unwrap(),result);
    assert!(command(&mut worker,sourced(&handle,"new",reference)).await.unwrap_err().contains("PERMISSION_DENIED"));
    assert_eq!(disk(&root),before);fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn stale_selection_and_missing_document_permission_cannot_be_attached() {
    for permission in [true,false] {
        let (root,state,mut worker,_,reference)=source_fixture();
        let mut manifest=state.list_capabilities().unwrap().into_iter().find(|cap|cap.manifest.id=="example.notes").unwrap().manifest;
        if !permission {manifest.permissions.retain(|value|*value!=CapabilityPermission::DocumentsReadSelected);}
        state.update_capability(manifest).unwrap();
        let handle=state.grant_board_creation("native-a","example.notes","0.1.0").unwrap();
        assert!(command(&mut worker,sourced(&handle,"stale",reference)).await.unwrap_err().contains("PERMISSION_DENIED"));
        assert!(!root.join("task-board.json").exists());
        command(&mut worker,request(&handle,"source-free")).await.unwrap();fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn duplicate_and_excessive_selected_references_fail_without_truncation() {
    let (root,_state,mut worker,handle,reference)=source_fixture();
    for count in [2,51] {
        let mut value=request(&handle,"invalid");value["input"]["sources"]=json!(vec![reference.clone();count]);
        assert!(command(&mut worker,value).await.unwrap_err().contains("INVALID_INPUT"));
        assert!(!root.join("task-board.json").exists());
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn interrupted_restore_blocks_sourced_creation_and_existing_receipt_replay() {
    let (root,_state,mut worker,handle,reference)=source_fixture();
    command(&mut worker,request(&handle,"existing")).await.unwrap();let before=disk(&root);
    fs::create_dir(root.join(".data-restore")).unwrap();fs::write(root.join(".data-restore/prepared.json"),b"\"incomplete\"").unwrap();
    for value in [request(&handle,"existing"),sourced(&handle,"new",reference)] {
        assert!(command(&mut worker,value).await.unwrap_err().contains("RESOURCE_BUSY"));
        assert_eq!(disk(&root),before);
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn combined_selected_sources_obey_the_task_input_byte_limit() {
    let (root,state,mut worker,handle,_)=source_fixture();let mut references=Vec::new();
    for index in 0..5 {
        let document=state.publish_document("example.notes",app_lib::document_library::DocumentPublication {key:format!("large-{index}"),title:format!("Large {index}"),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-20".into(),content:"x".repeat(2_000_000)}).unwrap();
        let grant=state.grant_documents("example.notes",vec![document.id],&format!("large-{index}")).unwrap();
        references.push(serde_json::to_value(&grant.documents[0].reference).unwrap());
    }
    let mut over=request(&handle,"over");over["input"]["sources"]=json!(references);
    assert!(command(&mut worker,over).await.unwrap_err().contains("RESOURCE_LIMIT"));assert!(!root.join("task-board.json").exists());
    let mut exact=request(&handle,"exact");exact["input"]["sources"]=json!(&references[..4]);
    command(&mut worker,exact).await.unwrap();assert_eq!(disk(&root)["cards"][0]["sources"].as_array().unwrap().len(),4);
    assert!(fs::metadata(root.join("task-board.json")).unwrap().len()<10_000);
    let sources:Vec<_>=references.iter().map(|reference|json!({"id":reference["documentId"],"title":reference["title"],"reference":reference})).collect();
    let before=disk(&root);
    assert!(command(&mut worker,json!({"op":"add","id":"large-goal","title":"Too large","description":"","sources":sources})).await.is_err());
    assert_eq!(disk(&root),before);assert!(!root.join("source-snapshots/large-goal.json").exists());
    command(&mut worker,json!({"op":"add","id":"exact-goal","title":"Exact limit","description":"","sources":&sources[..4]})).await.unwrap();
    assert_eq!(app_lib::source_snapshots::read(&root,"exact-goal").unwrap().iter().map(|doc|doc.content.len()).sum::<usize>(),8_000_000);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn user_goal_keeps_selected_content_after_edit_revoke_and_uninstall() {
    use std::os::unix::fs::PermissionsExt;
    let (root,state,worker,_,reference)=source_fixture();drop(worker);
    state.publish_document("example.notes",app_lib::document_library::DocumentPublication {key:"minutes".into(),title:"Edited".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-20".into(),content:"Changed original".into()}).unwrap();
    state.revoke_document_grant("selected").unwrap();state.uninstall_capability("example.notes").unwrap();
    app_lib::library_management::change(&root,app_lib::library_management::LibraryChange::DeleteDocuments { ids:vec![reference["documentId"].as_str().unwrap().into()] }).unwrap();
    assert!(app_lib::document_library::read_document(&root,reference["documentId"].as_str().unwrap()).is_err());
    assert!(state.read_selected_document("example.notes","selected",reference["documentId"].as_str().unwrap()).is_err());
    let binary=root.join("codex");fs::write(&binary,include_str!("fixtures/fake_codex.py")).unwrap();
    fs::set_permissions(&binary,fs::Permissions::from_mode(0o755)).unwrap();
    let mut worker=GoalWorker::new(root.clone(),binary.to_string_lossy().into());
    let sources=json!([{"id":reference["documentId"],"title":reference["title"],"reference":reference}]);
    command(&mut worker,json!({"op":"add","id":"selected-goal","title":"User delegated","description":"Use selected text","sources":sources})).await.unwrap();
    let selected=app_lib::source_snapshots::source(&root,"selected-goal",reference["documentId"].as_str().unwrap()).unwrap();
    assert_eq!(selected.content,"Original selected input");assert_eq!(selected.reference["grantId"],"selected");
    let snapshot=fs::read(root.join("source-snapshots/selected-goal.json")).unwrap();
    // Once captured, retry/startup must not require the old grant file or current document.
    fs::remove_file(root.join("document-grants/selected.json")).unwrap();
    worker.tick().await.unwrap();
    let board=disk(&root);assert_eq!(board["cards"][0]["status"],"running");
    let brief=fs::read_to_string(root.join("task-inputs/selected-goal.md")).unwrap();
    assert!(brief.contains("Original selected input"));assert!(!brief.contains("Changed original"));
    drop(worker);let mut worker=GoalWorker::new(root.clone(),binary.to_string_lossy().into());
    command(&mut worker,json!({"op":"stop","id":"selected-goal"})).await.unwrap();
    assert_eq!(fs::read(root.join("source-snapshots/selected-goal.json")).unwrap(),snapshot);
    drop(worker);fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn selected_goal_cannot_reuse_an_id_only_snapshot_or_fall_back_to_current_text() {
    let (root,state,mut worker,_,reference)=source_fixture();
    app_lib::source_snapshots::capture(&root,"old-snapshot",&[reference["documentId"].as_str().unwrap().into()]).unwrap();
    let sources=json!([{"id":reference["documentId"],"title":reference["title"],"reference":reference}]);
    let add=|id:&str|json!({"op":"add","id":id,"title":"Explicit user task","description":"","sources":sources});
    assert!(command(&mut worker,add("old-snapshot")).await.is_err());
    fs::remove_file(root.join("document-grants/selected.json")).unwrap();
    assert!(command(&mut worker,add("missing-selection")).await.is_err());
    assert!(!root.join("task-board.json").exists());assert!(!root.join("source-snapshots/missing-selection.json").exists());
    drop(state);fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn task_restore_and_goal_admission_reject_malformed_selected_reference_shapes() {
    let (root,state,mut worker,handle,reference)=source_fixture();
    command(&mut worker,sourced(&handle,"canonical",reference.clone())).await.unwrap();
    let backup=app_lib::user_data::capture(&root,BTreeMap::new(),serde_json::to_value(state.list_capabilities().unwrap()).unwrap()).unwrap();
    let original=disk(&root);let mut cases=vec![Value::Null,json!({})];
    for (field,value) in [("documentId",json!("example.notes/notes/2026/11/other")),("kind",json!("artifact")),("title",json!("Forged")),("grantId",json!("../escape")),("revision",json!(4)),("snapshotId",json!("extra"))] {
        let mut changed=reference.clone();changed[field]=value;cases.push(changed);
    }
    for value in cases {
        let mut board=original.clone();board["cards"][0]["sources"][0]["reference"]=value;
        let mut invalid=backup.clone();invalid.files.insert("task-board.json".into(),board.to_string());
        assert!(app_lib::user_data::validate(&invalid).is_err());
        assert!(command(&mut worker,json!({"op":"add","id":"invalid-goal","title":"Invalid","description":"","sources":board["cards"][0]["sources"]})).await.is_err());
        assert_eq!(disk(&root),original);assert!(!root.join("source-snapshots/invalid-goal.json").exists());
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn changing_a_selected_grant_with_the_same_document_id_blocks_goal_startup() {
    let (root,state,mut worker,_,reference)=source_fixture();
    let sources=json!([{"id":reference["documentId"],"title":reference["title"],"reference":reference}]);
    command(&mut worker,json!({"op":"add","id":"changed-selection","title":"User task","description":"","sources":sources})).await.unwrap();
    let before=fs::read(root.join("source-snapshots/changed-selection.json")).unwrap();
    let replacement=state.grant_documents("example.notes",vec![reference["documentId"].as_str().unwrap().into()],"replacement").unwrap();
    let mut board=disk(&root);board["cards"][0]["sources"][0]["reference"]=serde_json::to_value(&replacement.documents[0].reference).unwrap();
    fs::write(root.join("task-board.json"),board.to_string()).unwrap();
    worker.tick().await.unwrap();let card=disk(&root)["cards"][0].clone();
    assert_eq!(card["error"],"Snapshot selection differs");assert!(card.get("threadId").is_none());
    assert_eq!(fs::read(root.join("source-snapshots/changed-selection.json")).unwrap(),before);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn plain_goal_references_capture_current_text_once_and_legacy_snapshot_reads_still_work() {
    let (root,state,mut worker,_,reference)=source_fixture();
    let publish=|content:&str|app_lib::document_library::DocumentPublication {key:"minutes".into(),title:"Edited".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-20".into(),content:content.into()};
    state.publish_document("example.notes",publish("Current at user delegation")).unwrap();
    command(&mut worker,json!({"op":"add","id":"plain-goal","title":"Plain source","description":"","sources":[{"id":reference["documentId"],"title":"Edited"}]})).await.unwrap();
    state.publish_document("example.notes",publish("Later edit")).unwrap();
    worker.tick().await.unwrap();
    let brief=fs::read_to_string(root.join("task-inputs/plain-goal.md")).unwrap();
    assert!(brief.contains("Current at user delegation"));assert!(!brief.contains("Later edit"));
    let saved=app_lib::source_snapshots::capture(&root,"plain-goal",&[reference["documentId"].as_str().unwrap().into()]).unwrap();
    assert_eq!(saved[0].content,"Current at user delegation");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn existing_goal_replay_rejects_changed_selected_identity_without_an_effect() {
    let (root,state,mut worker,_,reference)=source_fixture();
    let mut request=json!({"op":"add","id":"replayed-goal","title":"User task","description":"","sources":[{"id":reference["documentId"],"title":reference["title"],"reference":reference}]});
    let expected=command(&mut worker,request.clone()).await.unwrap();
    state.revoke_document_grant("selected").unwrap();
    assert_eq!(command(&mut worker,request.clone()).await.unwrap(),expected);
    let before=fs::read(root.join("source-snapshots/replayed-goal.json")).unwrap();
    request["sources"][0]["reference"]["grantId"]=json!("different-selection");
    assert!(command(&mut worker,request).await.is_err());
    assert_eq!(disk(&root),expected);assert_eq!(fs::read(root.join("source-snapshots/replayed-goal.json")).unwrap(),before);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn array_shaped_task_sources_are_not_deserialized_as_valid_reference_objects() {
    let (root,state,mut worker,_,reference)=source_fixture();
    let sources=json!([[reference["documentId"],"Incorrect title",reference]]);
    let mut backup=app_lib::user_data::capture(&root,BTreeMap::new(),serde_json::to_value(state.list_capabilities().unwrap()).unwrap()).unwrap();
    backup.files.insert("task-board.json".into(),json!({"cards":[{"id":"bad","title":"Bad source","description":"","status":"todo","sources":sources}]}).to_string());
    assert!(app_lib::user_data::validate(&backup).is_err());
    assert!(command(&mut worker,json!({"op":"add","id":"bad","title":"Bad source","description":"","sources":sources})).await.is_err());
    assert!(!root.join("task-board.json").exists());assert!(!root.join("source-snapshots/bad.json").exists());
    fs::remove_dir_all(root).unwrap();
}
