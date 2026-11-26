#![cfg(unix)]
use app_lib::{capability_runtime::{CapabilityManifest, PlatformState}, document_library::DocumentPublication, task_goals::GoalWorker, task_selection};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

struct Fixture { root: PathBuf, state: PlatformState, worker: GoalWorker, handle: String, grant: Value, doc: String }
impl Fixture {
    fn new() -> Self {
        // Keep Unix socket paths within macOS SUN_LEN, independent of a long TMPDIR.
        let root=PathBuf::from("/tmp").join(format!("nooki-attachment-{}-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        let state=PlatformState::load(root.clone()).unwrap();
        for id in ["example.writer","example.peer"] {
            let manifest:CapabilityManifest=serde_json::from_value(json!({"id":id,"name":id,"description":"","version":"1.0.0","entrypoints":["page"],"permissions":["board.create","board.attach-delivery","documents.publish","documents.read-selected"],"minPlatformVersion":"0.7.0"})).unwrap();
            state.install_capability(manifest).unwrap();
        }
        state.write_task_board(&json!({"cards":[{"id":"user-task","title":"Review notes","description":"User-owned task","status":"todo","delivery":{"text":"Existing agent result","artifacts":[]}},{"id":"other-task","title":"Other task","description":"Unchanged","status":"todo"}]})).unwrap();
        let ticket=task_selection::begin(&state,"main",json!({"requestId":"approval","capabilityId":"example.writer","version":"1.0.0","purpose":"Attach meeting notes","operations":["attachDelivery"],"limit":1})).unwrap();
        let grant=task_selection::commit(&state,"main",json!({"handle":ticket["handle"],"items":[{"id":"user-task","revision":1}]})).unwrap();
        let doc=state.publish_document("example.writer",publication("Original delivery")).unwrap().id;
        let handle=state.grant_board_attachment("main","example.writer","1.0.0").unwrap();
        let worker=GoalWorker::new(root.clone(),"/missing-agent-must-not-start".into());
        Self { root,state,worker,handle,grant,doc }
    }
    fn request(&self, key:&str) -> Value { json!({"op":"capability-attach-delivery","caller":"main","handle":self.handle,"key":key,"input":{"grantId":self.grant["id"],"item":{"id":"user-task","revision":1},"title":"Reviewed notes","documents":[{"kind":"library-document","documentId":self.doc,"title":"Notes"}]}}) }
    fn board(&self) -> Value { serde_json::from_slice(&fs::read(self.root.join("task-board.json")).unwrap()).unwrap() }
}
impl Drop for Fixture { fn drop(&mut self) { let _=fs::remove_dir_all(&self.root); } }
fn publication(content:&str) -> DocumentPublication { DocumentPublication {key:"notes".into(),title:"Notes".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-24".into(),content:content.into()} }

#[tokio::test]
async fn attachment_preserves_task_control_and_agent_delivery_and_commits_its_receipt() {
    let mut f=Fixture::new();let before=f.board();let request=f.request("first");
    let result=f.worker.command(request.clone()).await.unwrap();let board=f.board();
    assert_eq!(result["item"],json!({"id":"user-task","revision":3}));
    assert_eq!(board["cards"][0]["delivery"],before["cards"][0]["delivery"]);
    assert_eq!(board["cards"][1],before["cards"][1]);
    for key in ["status","title","description","authorization","execution","threadId","runId"] { assert_eq!(board["cards"][0][key],before["cards"][0][key]); }
    let delivery=&board["cards"][0]["attachedDeliveries"][0];
    assert_eq!(delivery["id"],result["deliveryId"]);assert_eq!(delivery["documents"][0]["content"],"Original delivery");
    assert_eq!(delivery["provenance"]["capabilityId"],"example.writer");
    assert_eq!(board["attachmentReceipts"].as_object().unwrap().len(),1);
    assert_eq!(f.worker.command(request).await.unwrap(),result);assert_eq!(f.board(),board);
    f.worker.tick().await.unwrap();assert_eq!(f.board(),board);
}

#[tokio::test]
async fn wrong_package_operation_task_or_stale_revision_leaves_no_effect() {
    let mut f=Fixture::new();let before=f.board();
    let peer=f.state.grant_board_attachment("main","example.peer","1.0.0").unwrap();
    let create=f.state.grant_board_creation("main","example.writer","1.0.0").unwrap();
    for (field,value) in [("handle",json!(peer)),("handle",json!(create)),("caller",json!("other-view"))] {
        let mut request=f.request("denied");request[field]=value;assert!(f.worker.command(request).await.unwrap_err().contains("PERMISSION_DENIED"));assert_eq!(f.board(),before);
    }
    for item in [json!({"id":"other-task","revision":2}),json!({"id":"user-task","revision":999})] {
        let mut request=f.request("wrong-item");request["input"]["item"]=item;assert!(f.worker.command(request).await.is_err());assert_eq!(f.board(),before);
    }
    let mut edit=before;edit["cards"][0]["title"]=json!("Concurrent user edit");f.state.write_task_board(&edit).unwrap();
    let changed=f.board();assert!(f.worker.command(f.request("stale")).await.unwrap_err().contains("CONFLICT"));assert_eq!(f.board(),changed);
}

#[tokio::test]
async fn failed_precommit_retry_is_atomic_and_retains_only_the_committed_snapshot() {
    let mut f=Fixture::new();let before=fs::read(f.root.join("task-board.json")).unwrap();let request=f.request("retry");
    fs::create_dir(f.root.join("task-board.pending")).unwrap();assert!(f.worker.command(request.clone()).await.is_err());
    assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);fs::remove_dir(f.root.join("task-board.pending")).unwrap();
    f.state.publish_document("example.writer",publication("Updated before commit")).unwrap();
    let result=f.worker.command(request.clone()).await.unwrap();let board=f.board();
    assert_eq!(board["cards"][0]["attachedDeliveries"][0]["documents"][0]["content"],"Updated before commit");
    assert_eq!(f.worker.command(request).await.unwrap(),result);assert_eq!(f.board(),board);
}

#[tokio::test]
async fn retained_delivery_survives_source_change_revocation_and_package_removal() {
    let mut f=Fixture::new();let request=f.request("retained");let result=f.worker.command(request.clone()).await.unwrap();
    let delivered=f.board()["cards"][0]["attachedDeliveries"].clone();
    f.state.publish_document("example.writer",publication("Changed after commit")).unwrap();
    app_lib::library_management::change(&f.root,app_lib::library_management::LibraryChange::DeleteDocuments {ids:vec![f.doc.clone()]}).unwrap();
    task_selection::revoke(&f.state,"main",json!({"id":f.grant["id"]})).unwrap();
    assert_eq!(f.worker.command(request.clone()).await.unwrap(),result);
    assert!(f.worker.command(f.request("new-after-revoke")).await.unwrap_err().contains("PERMISSION_DENIED"));
    f.state.uninstall_capability("example.writer").unwrap();
    assert!(f.worker.command(request).await.unwrap_err().contains("PERMISSION_DENIED"));
    assert_eq!(f.board()["cards"][0]["attachedDeliveries"],delivered);
}

#[tokio::test]
async fn selected_foreign_documents_require_exact_live_snapshot_authority() {
    let mut f=Fixture::new();let peer_doc=f.state.publish_document("example.peer",publication("Selected peer content")).unwrap();
    let mut request=f.request("selected");request["input"]["documents"][0]["documentId"]=json!(peer_doc.id);
    assert!(f.worker.command(request.clone()).await.unwrap_err().contains("PERMISSION_DENIED"));
    let grant=f.state.grant_documents("example.writer",vec![peer_doc.id.clone()],"selected-delivery").unwrap();
    request["input"]["documents"]=json!([grant.documents[0].reference]);
    let before=f.board();
    for (field,value) in [("title",json!("Forged title")),("revision",json!("forged")),("grantId",json!("unknown-grant"))] {
        let mut forged=request.clone();forged["input"]["documents"][0][field]=value;
        assert!(f.worker.command(forged).await.unwrap_err().contains("PERMISSION_DENIED"));assert_eq!(f.board(),before);
    }
    f.state.publish_document("example.peer",publication("New peer content")).unwrap();
    let result=f.worker.command(request.clone()).await.unwrap();
    assert_eq!(f.board()["cards"][0]["attachedDeliveries"][0]["documents"][0]["content"],"Selected peer content");
    f.state.revoke_document_grant(&grant.id).unwrap();assert_eq!(f.worker.command(request.clone()).await.unwrap(),result);
    let ticket=task_selection::begin(&f.state,"main",json!({"requestId":"after-source-revoke","capabilityId":"example.writer","version":"1.0.0","purpose":"Try revoked source","operations":["attachDelivery"],"limit":1})).unwrap();
    let task_grant=task_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"items":[result["item"]]})).unwrap();
    request["key"]=json!("new-after-source-revoke");request["input"]["grantId"]=task_grant["id"].clone();request["input"]["item"]=result["item"].clone();
    let before=f.board();assert!(f.worker.command(request).await.unwrap_err().contains("PERMISSION_DENIED"));assert_eq!(f.board(),before);
}

#[tokio::test]
async fn immutable_deliveries_and_receipts_survive_legacy_edits_deletion_and_restore() {
    let mut f=Fixture::new();let stale=f.board();let request=f.request("receipt");let result=f.worker.command(request.clone()).await.unwrap();
    let committed=f.board();assert!(f.state.write_task_board(&stale).unwrap_err().contains("CONFLICT"));
    let mut edit=committed.clone();edit["cards"][0]["title"]=json!("User edit");edit["cards"][0]["attachedDeliveries"]=json!([{"forged":true}]);edit["attachmentReceipts"]=json!({"forged":true});
    f.state.write_task_board(&edit).unwrap();let edited=f.board();
    assert_eq!(edited["cards"][0]["attachedDeliveries"],committed["cards"][0]["attachedDeliveries"]);assert_eq!(edited["attachmentReceipts"],committed["attachmentReceipts"]);
    assert_eq!(f.worker.command(request.clone()).await.unwrap(),result);
    let backup=app_lib::user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    let mut deleted=edited;deleted["cards"].as_array_mut().unwrap().remove(0);f.state.write_task_board(&deleted).unwrap();
    let after_delete=f.board();assert_eq!(f.worker.command(request.clone()).await.unwrap(),result);assert_eq!(f.board(),after_delete);
    app_lib::user_data::restore(&f.root,&backup,"restore-delivery").unwrap();
    assert_eq!(f.board()["cards"][0]["attachedDeliveries"],committed["cards"][0]["attachedDeliveries"]);
    assert_eq!(f.worker.command(request).await.unwrap(),result);
    assert!(f.worker.command(f.request("new-after-restore")).await.unwrap_err().contains("PERMISSION_DENIED"));
}

#[tokio::test]
async fn malformed_inputs_revision_mismatch_and_changed_intent_fail_without_writes() {
    let mut f=Fixture::new();let before=f.board();
    for (field,value) in [("status",json!("done")),("title",json!("")),("item",json!(["user-task",1])),("documents",json!([])),("documents",json!([["library-document",f.doc,"Notes"]]))] {
        let mut request=f.request("invalid");request["input"][field]=value;assert!(f.worker.command(request).await.unwrap_err().contains("INVALID_INPUT"));assert_eq!(f.board(),before);
    }
    for change in [json!({"snapshotId":"forged"}),json!({"grantId":null}),json!({"kind":"artifact"}),json!({"revision":null})] {
        let mut request=f.request("invalid-ref");request["input"]["documents"][0].as_object_mut().unwrap().extend(change.as_object().unwrap().clone());
        assert!(f.worker.command(request).await.unwrap_err().contains("INVALID_INPUT"));assert_eq!(f.board(),before);
    }
    let mut request=f.request("versioned");request["input"]["documents"][0]["revision"]=json!("stale-document-version");
    assert!(f.worker.command(request).await.unwrap_err().contains("CONFLICT"));assert_eq!(f.board(),before);
    let request=f.request("same-intent");f.worker.command(request.clone()).await.unwrap();let committed=f.board();
    let mut different=request;different["input"]["title"]=json!("Different intent");assert!(f.worker.command(different).await.unwrap_err().contains("CONFLICT"));assert_eq!(f.board(),committed);
}

#[tokio::test]
async fn postrename_uncertainty_recovers_the_committed_delivery_and_receipt() {
    use std::os::unix::fs::PermissionsExt;
    struct Restore(PathBuf);impl Drop for Restore {fn drop(&mut self){let _=fs::set_permissions(&self.0,fs::Permissions::from_mode(0o700));}}
    let mut f=Fixture::new();let restore=Restore(f.root.clone());let request=f.request("uncertain");
    fs::set_permissions(&f.root,fs::Permissions::from_mode(0o300)).unwrap();assert!(fs::File::open(&f.root).is_err());
    let error=f.worker.command(request.clone()).await.unwrap_err();drop(restore);assert!(error.contains("OUTCOME_UNKNOWN"),"{error}");
    let committed=f.board();assert_eq!(committed["cards"][0]["attachedDeliveries"].as_array().unwrap().len(),1);
    let result=f.worker.command(request).await.unwrap();assert_eq!(result["deliveryId"],committed["cards"][0]["attachedDeliveries"][0]["id"]);assert_eq!(f.board(),committed);
}

struct NativeWorker(std::process::Child);
impl NativeWorker {
    async fn start(root:&std::path::Path)->Self {
        // Run the same IPC checks against the installed release when verifying desktop delivery.
        let binary=std::env::var_os("NOOKI_ATTACHMENT_TEST_BINARY").unwrap_or_else(||env!("CARGO_BIN_EXE_app").into());
        let mut worker=Self(std::process::Command::new(binary).arg("--task-worker").arg(root).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(fs::File::create(root.join("worker-test.log")).unwrap()).spawn().unwrap());
        tokio::time::timeout(std::time::Duration::from_secs(10),async {loop {
            assert!(worker.0.try_wait().unwrap().is_none(),"worker exited before readiness: {}",fs::read_to_string(root.join("worker-test.log")).unwrap_or_default());
            if tokio::net::UnixStream::connect(root.join("task-worker.sock")).await.is_ok(){break}
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }}).await.unwrap();worker
    }
}
impl Drop for NativeWorker {fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}

#[tokio::test]
async fn actual_host_adapter_replays_concurrent_calls_and_lost_replies_across_restart() {
    use app_lib::capability_host::{board_attach,board_attachment_begin,board_release};
    use tokio::io::AsyncWriteExt;
    let f=Fixture::new();let native=NativeWorker::start(&f.root).await;
    assert!(board_attachment_begin(&f.state,"package-view",json!({"capabilityId":"example.writer","version":"1.0.0"})).is_err());
    let handle=board_attachment_begin(&f.state,"main",json!({"capabilityId":"example.writer","version":"1.0.0"})).unwrap();
    let request=f.request("concurrent");let public=json!({"handle":handle,"key":request["key"],"input":request["input"]});
    let mut forged=public.clone();forged["caller"]=json!("main");assert_eq!(serde_json::to_value(board_attach(&f.state,"main",forged).await.unwrap_err()).unwrap()["code"],"INVALID_INPUT");
    assert_eq!(serde_json::to_value(board_attach(&f.state,"other-view",public.clone()).await.unwrap_err()).unwrap()["code"],"PERMISSION_DENIED");
    let (a,b)=tokio::join!(board_attach(&f.state,"main",public.clone()),board_attach(&f.state,"main",public.clone()));let result=a.unwrap();assert_eq!(b.unwrap(),result);
    assert_eq!(f.board()["cards"][0]["attachedDeliveries"].as_array().unwrap().len(),1);
    let ticket=task_selection::begin(&f.state,"main",json!({"requestId":"second-approval","capabilityId":"example.writer","version":"1.0.0","purpose":"Attach to other task","operations":["attachDelivery"],"limit":1})).unwrap();
    let grant=task_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"items":[{"id":"other-task","revision":2}]})).unwrap();
    let mut lost=request.clone();lost["key"]=json!("lost-first-reply");lost["input"]["grantId"]=grant["id"].clone();lost["input"]["item"]=json!({"id":"other-task","revision":2});
    // Dispatch a NEW effect and close before reading its first reply.
    let mut stream=tokio::net::UnixStream::connect(f.root.join("task-worker.sock")).await.unwrap();
    stream.write_all(format!("{}\n",lost).as_bytes()).await.unwrap();drop(stream);
    tokio::time::timeout(std::time::Duration::from_secs(5),async {
        while f.board()["cards"][1]["attachedDeliveries"].as_array().is_none_or(|deliveries| deliveries.len()!=1) { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
    }).await.unwrap();
    let before=f.board();drop(native);
    let restarted=PlatformState::load(f.root.clone()).unwrap();let native=NativeWorker::start(&f.root).await;
    assert_eq!(serde_json::to_value(board_attach(&restarted,"main",public.clone()).await.unwrap_err()).unwrap()["code"],"PERMISSION_DENIED");
    let handle=board_attachment_begin(&restarted,"main",json!({"capabilityId":"example.writer","version":"1.0.0"})).unwrap();
    let mut fresh=public;fresh["handle"]=json!(handle);assert_eq!(board_attach(&restarted,"main",fresh).await.unwrap(),result);
    let recovered=board_attach(&restarted,"main",json!({"handle":handle,"key":lost["key"],"input":lost["input"]})).await.unwrap();
    assert_eq!(recovered["deliveryId"],before["cards"][1]["attachedDeliveries"][0]["id"]);assert_eq!(f.board(),before);
    assert!(app_lib::task_worker::renderer_request(&f.root,request).await.unwrap_err().contains("PERMISSION_DENIED"));
    board_release(&restarted,"main",json!({"handle":handle})).unwrap();drop(native);
}

#[tokio::test]
async fn queued_attachment_rechecks_authority_after_revocation_before_the_effect() {
    use tokio::io::{AsyncBufReadExt,AsyncWriteExt,BufReader};
    let f=Fixture::new();let native=NativeWorker::start(&f.root).await;let before=f.board();
    let mut blocker=tokio::net::UnixStream::connect(f.root.join("task-worker.sock")).await.unwrap();blocker.write_all(b"{\"op\":\"read\"").await.unwrap();
    let mut queued=tokio::net::UnixStream::connect(f.root.join("task-worker.sock")).await.unwrap();queued.write_all(format!("{}\n",f.request("late")).as_bytes()).await.unwrap();
    f.state.revoke_board_invocation("main",&f.handle).unwrap();drop(blocker);
    let mut response=String::new();tokio::time::timeout(std::time::Duration::from_secs(5),BufReader::new(queued).read_line(&mut response)).await.unwrap().unwrap();
    assert!(serde_json::from_str::<Value>(&response).unwrap()["error"].as_str().unwrap().contains("PERMISSION_DENIED"));assert_eq!(f.board(),before);drop(native);
}

#[tokio::test]
async fn published_canonical_revision_succeeds_and_republication_invalidates_it() {
    let mut f=Fixture::new();let metadata=f.state.publish_document("example.writer",publication("Versioned content")).unwrap();
    let mut request=f.request("exact-publication");request["input"]["documents"][0]["revision"]=json!(metadata.revision);
    f.worker.command(request).await.unwrap();
    assert_eq!(f.board()["cards"][0]["attachedDeliveries"][0]["documents"][0]["reference"]["revision"],json!(metadata.revision));
    let mut other=Fixture::new();let old=other.state.publish_document("example.writer",publication("Old")).unwrap();
    other.state.publish_document("example.writer",publication("Replacement")).unwrap();let before=other.board();
    let mut request=other.request("stale-publication");request["input"]["documents"][0]["revision"]=json!(old.revision);
    assert!(other.worker.command(request).await.unwrap_err().contains("CONFLICT"));assert_eq!(other.board(),before);
}

#[test]
fn publication_child_for_attachment_race() {
    let Ok(root)=std::env::var("NOOKI_ATTACHMENT_RACE_ROOT") else {return};
    let root=PathBuf::from(root);fs::write(root.join("publisher-attempt"),b"ready").unwrap();
    let action=std::env::var("NOOKI_ATTACHMENT_RACE_ACTION").unwrap_or_else(|_|"publish".into());
    if action=="publish" { app_lib::document_library::publish_document(&root,"example.writer","Writer",publication("Concurrent publication")).unwrap(); }
    else {
        let id=std::env::var("NOOKI_ATTACHMENT_RACE_DOCUMENT").unwrap();
        let change=if action=="edit" { app_lib::library_management::LibraryChange::Edit {id,title:"Notes".into(),content:"Concurrent edit".into(),expected:std::env::var("NOOKI_ATTACHMENT_RACE_REVISION").unwrap()} }
            else {app_lib::library_management::LibraryChange::DeleteDocuments {ids:vec![id]}};
        app_lib::library_management::change(&root,change).unwrap();
    }
    fs::write(root.join("publisher-finished"),b"done").unwrap();
}

#[tokio::test]
async fn source_publication_in_another_process_waits_until_attachment_save_finishes() {
    use std::{io::Read,os::unix::ffi::OsStrExt};
    use tokio::io::{AsyncBufReadExt,AsyncWriteExt,BufReader};
    for action in ["publish","edit","delete"] {
    let mut f=Fixture::new();let metadata=f.state.publish_document("example.writer",publication(&"x".repeat(1_000_000))).unwrap();
    let before=f.board();let native=NativeWorker::start(&f.root).await;
    let pending=f.root.join("task-board.pending");let name=std::ffi::CString::new(pending.as_os_str().as_bytes()).unwrap();
    // A FIFO blocks the real worker after capture, inside the existing board-save write.
    assert_eq!(unsafe{libc::mkfifo(name.as_ptr(),0o600)},0);
    let request=f.request("barrier");let mut stream=tokio::net::UnixStream::connect(f.root.join("task-worker.sock")).await.unwrap();stream.write_all(format!("{}\n",request).as_bytes()).await.unwrap();
    let mut reader=fs::File::open(&pending).unwrap();
    let mut publisher=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","publication_child_for_attachment_race","--nocapture"])
        .env("NOOKI_ATTACHMENT_RACE_ROOT",&f.root).env("NOOKI_ATTACHMENT_RACE_ACTION",action).env("NOOKI_ATTACHMENT_RACE_DOCUMENT",&f.doc).env("NOOKI_ATTACHMENT_RACE_REVISION",metadata.revision.unwrap())
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(3);
    while !f.root.join("publisher-attempt").exists(){assert!(std::time::Instant::now()<deadline);std::thread::sleep(std::time::Duration::from_millis(5));}
    let observe=std::time::Instant::now()+std::time::Duration::from_secs(1);
    while std::time::Instant::now()<observe && publisher.try_wait().unwrap().is_none() { std::thread::sleep(std::time::Duration::from_millis(5)); }
    let blocked=publisher.try_wait().unwrap().is_none() && !f.root.join("publisher-finished").exists();
    // Prevent the FIFO itself becoming the authoritative board after the writer drains.
    fs::remove_file(&pending).unwrap();
    let mut discarded=Vec::new();reader.read_to_end(&mut discarded).unwrap();drop(reader);
    let mut reply=String::new();BufReader::new(stream).read_line(&mut reply).await.unwrap();assert!(serde_json::from_str::<Value>(&reply).unwrap()["error"].is_string());
    assert!(publisher.wait().unwrap().success());
    assert!(blocked,"{action} escaped while the attachment was inside its board save");assert_eq!(f.board(),before);
    // The failed attempt committed nothing; a later retry can capture the subsequent publication.
    if action=="delete" { assert!(f.worker.command(request).await.is_err());assert_eq!(f.board(),before); }
    else { f.worker.command(request).await.unwrap();assert_eq!(f.board()["cards"][0]["attachedDeliveries"][0]["documents"][0]["content"],if action=="edit" {"Concurrent edit"} else {"Concurrent publication"}); }
    drop(native);
    }
}

#[tokio::test]
async fn retained_byte_and_receipt_capacity_preserve_existing_outcomes() {
    let mut f=Fixture::new();let mut documents=Vec::new();
    for index in 0..5 {
        let mut document=publication(&"x".repeat(2_000_000));document.key=format!("large-{index}");let metadata=f.state.publish_document("example.writer",document).unwrap();
        documents.push(json!({"kind":"library-document","documentId":metadata.id,"title":"Notes"}));
    }
    let before=f.board();let mut large=f.request("too-large");large["input"]["documents"]=json!(documents);
    assert!(f.worker.command(large).await.unwrap_err().contains("RESOURCE_LIMIT"));assert_eq!(f.board(),before);
    let request=f.request("kept");let result=f.worker.command(request.clone()).await.unwrap();let mut board=f.board();
    let sample=board["attachmentReceipts"].as_object().unwrap().values().next().unwrap().clone();
    for index in 0..255 {let mut receipt=sample.clone();receipt["result"]["deliveryId"]=json!(format!("{index:064x}"));board["attachmentReceipts"][format!("{index:064x}")]=receipt;}
    fs::write(f.root.join("task-board.json"),serde_json::to_vec(&board).unwrap()).unwrap();
    assert!(f.worker.command(f.request("full")).await.unwrap_err().contains("RESOURCE_LIMIT"));
    assert_eq!(f.worker.command(request).await.unwrap(),result);assert_eq!(f.board(),board);
    let mut backup=app_lib::user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    board["cards"][0]["attachedDeliveries"][0]["accepted"]=json!(true);backup.files.insert("task-board.json".into(),board.to_string());
    assert!(app_lib::user_data::validate(&backup).is_err());
}

#[tokio::test]
async fn attachment_invocations_need_no_create_permission_and_cannot_create_tasks() {
    let mut f=Fixture::new();let mut manifest=f.state.list_capabilities().unwrap().into_iter().find(|c|c.manifest.id=="example.writer").unwrap().manifest;
    manifest.permissions.retain(|p| *p != app_lib::capability_runtime::CapabilityPermission::BoardCreate);f.state.update_capability(manifest).unwrap();
    let ticket=task_selection::begin(&f.state,"main",json!({"requestId":"attach-only","capabilityId":"example.writer","version":"1.0.0","purpose":"Attach only","operations":["attachDelivery"],"limit":1})).unwrap();
    f.grant=task_selection::commit(&f.state,"main",json!({"handle":ticket["handle"],"items":[{"id":"user-task","revision":1}]})).unwrap();
    f.handle=f.state.grant_board_attachment("main","example.writer","1.0.0").unwrap();
    let before=f.board();assert!(f.worker.command(json!({"op":"capability-create","caller":"main","handle":f.handle,"key":"wrong-operation","input":{"title":"Must not create"}})).await.unwrap_err().contains("PERMISSION_DENIED"));assert_eq!(f.board(),before);
    f.worker.command(f.request("attach-only")).await.unwrap();assert_eq!(f.board()["cards"].as_array().unwrap().len(),2);
}

#[tokio::test]
async fn interrupted_restore_blocks_new_attachments_and_metadata_replay() {
    let mut f=Fixture::new();let request=f.request("before-interruption");f.worker.command(request.clone()).await.unwrap();let before=f.board();
    fs::create_dir(f.root.join(".data-restore")).unwrap();fs::write(f.root.join(".data-restore/prepared.json"),b"\"unfinished\"").unwrap();
    assert!(f.worker.command(request).await.unwrap_err().contains("RESOURCE_BUSY"));assert!(f.worker.command(f.request("new")).await.unwrap_err().contains("RESOURCE_BUSY"));assert_eq!(f.board(),before);
}
