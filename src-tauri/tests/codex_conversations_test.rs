use app_lib::{capability_bridge::CapabilityBridge, codex_conversations::CodexConversations, conversation_documents::{self, Attachment, DocumentInputs}, conversation_host::ConversationHost, source_snapshots, document_library::{self, DocumentPublication}};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Arc, Mutex}};
use tokio_util::sync::CancellationToken;
#[tokio::test]
async fn async_question_answers_steer_the_original_turn_and_survive_history() {
  let (root, bridge, events) = fixture(); let bridge = Arc::new(bridge);
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap().to_string();
  let token = CancellationToken::new(); let run_token = token.clone(); let running = bridge.clone(); let session = id.clone();
  let handle = tokio::spawn(async move { running.run(&session, "async-question", "", "question-run", run_token).await });
  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    loop {
      if events.lock().unwrap().iter().any(|event| event["params"]["item"]["delivery"] == "async") { break; }
      tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
  }).await.unwrap();
  assert!(!handle.is_finished(), "An async question does not complete the running task");
  let history = bridge.read(&id, None).await.unwrap();
  assert_eq!(history["turns"][0]["items"][1]["questions"][0]["options"], json!(["Notes", "Documents"]));
  assert!(bridge.answer_question(&id, "turn-1", "question-1", &[]).await.is_err());
  assert!(bridge.answer_question(&id, "turn-1", "question-1", &[" ".into()]).await.is_err());
  assert!(bridge.answer_question(&id, "turn-1", "other", &["Notes".into()]).await.is_err());
  assert!(bridge.answer_question("unrelated", "turn-1", "question-1", &["Notes".into()]).await.is_err());
  bridge.answer_question(&id, "turn-1", "question-1", &["Notes".into()]).await.unwrap();
  bridge.answer_question(&id, "turn-1", "question-1", &["Notes".into()]).await.unwrap();
  assert!(!handle.is_finished(), "Answering steers instead of interrupting or starting a second task");
  let history = bridge.read(&id, None).await.unwrap();
  assert_eq!(history["turns"].as_array().unwrap().len(), 1);
  assert_eq!(history["turns"][0]["items"][2]["clientId"], "async-answer-question-1");
  assert_eq!(history["turns"][0]["items"][2]["content"][0]["text"], "Which source?\nNotes");
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  let steers: Vec<_> = requests.iter().filter(|request| request["method"] == "turn/steer").collect();
  assert_eq!(steers.len(), 1, "Duplicate submissions do not steer twice");
  assert_eq!(steers[0]["params"]["expectedTurnId"], "turn-1");
  token.cancel(); assert!(handle.await.unwrap().is_err());
  drop(bridge);
  let reopened = CodexConversations::new(root.join("codex").to_string_lossy().into(), root.clone(), Arc::new(|_| {}));
  reopened.answer_question(&id, "turn-1", "question-1", &["Notes".into()]).await.unwrap();
  assert_eq!(reopened.read(&id, None).await.unwrap()["turns"][0]["items"].as_array().unwrap().len(), 3);
  drop(reopened); let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn native_conversation_creation_stays_with_the_selected_agent() {
  let root = std::env::temp_dir().join(format!("workbench-agent-test-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&root);
  let host = ConversationHost::new("codex".into(), root.clone(), Arc::new(|_| {}));
  let pi = host.create("pi").await.unwrap();
  let claude = host.create("claude").await.unwrap();
  assert_eq!(pi["agent"], "pi");
  assert_eq!(claude["agent"], "claude");
  assert_eq!(host.read(pi["id"].as_str().unwrap(), None).await.unwrap()["agent"], "pi");
  assert_eq!(host.read(claude["id"].as_str().unwrap(), None).await.unwrap()["agent"], "claude");
  assert!(root.join("conversation-agents.json").is_file());
  let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn closing_the_ui_keeps_the_worker_and_reconnects_without_another_user_message() {
  let (root, initial, _) = fixture();
  let binary = root.join("codex").to_string_lossy().to_string();
  drop(initial);
  for finish_while_closed in [false, true] {
    let events = Arc::new(Mutex::new(Vec::<Value>::new())); let sink = events.clone();
    let bridge = Arc::new(CodexConversations::new(binary.clone(), root.clone(), Arc::new(move |e| sink.lock().unwrap().push(e))));
    let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap().to_string();
    let request = if finish_while_closed { "closed-complete" } else { "closed-running" };
    let running = bridge.clone(); let session = id.clone();
    let handle = tokio::spawn(async move { running.run(&session, "slow", "", request, CancellationToken::new()).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
      while !events.lock().unwrap().iter().any(|e| e["method"] == "turn/started") { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
    }).await.unwrap();
    let pid = std::fs::read_to_string(root.join("conversation-workspace/fake-daemon.pid")).unwrap();
    // Dropping the app-side observer and connection is not user cancellation.
    handle.abort(); let _ = handle.await; drop(bridge);
    if finish_while_closed {
      std::fs::write(root.join("conversation-workspace/finish-background"), "").unwrap();
      tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while root.join("conversation-workspace/finish-background").exists() { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
      }).await.unwrap();
    }
    let reopened = Arc::new(CodexConversations::new(binary.clone(), root.clone(), Arc::new(|_| {})));
    let session = id.clone(); let observing = reopened.clone();
    let recovery = tokio::spawn(async move { observing.reconnect(&session, request, CancellationToken::new()).await });
    if !finish_while_closed {
      assert_eq!(reopened.read(&id, None).await.unwrap()["turns"][0]["status"], "inProgress");
      assert!(!recovery.is_finished());
      std::fs::write(root.join("conversation-workspace/finish-background"), "").unwrap();
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), recovery).await.unwrap().unwrap().unwrap();
    assert_eq!(result["artifacts"][0]["content"], "Completed by the background worker");
    assert_eq!(std::fs::read_to_string(root.join("conversation-workspace/fake-daemon.pid")).unwrap(), pid, "The same CLI process survived disconnection");
    let history = reopened.read(&id, None).await.unwrap();
    assert_eq!(history["turns"].as_array().unwrap().len(), 1);
    assert_eq!(history["turns"][0]["items"].as_array().unwrap().iter().filter(|item| item["type"] == "userMessage").count(), 1);
    drop(reopened);
  }
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  assert_eq!(requests.iter().filter(|r| r["method"] == "turn/start").count(), 2);
  assert!(!requests.iter().any(|r| r["method"] == "turn/interrupt"));
  let _ = std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn native_creation_time_survives_updates_and_legacy_catalogs() {
  let root = std::env::temp_dir().join(format!("workbench-creation-test-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&root);
  let host = ConversationHost::new("codex".into(), root.clone(), Arc::new(|_| {}));
  for agent in ["pi", "claude"] {
    let thread = host.create(agent).await.unwrap();
    let id = thread["id"].as_str().unwrap();
    let created = thread["createdAt"].as_f64().unwrap();
    assert!(created > 1_000_000_000.0 && created < 10_000_000_000.0, "creation uses Unix seconds");
    let path = root.join("conversation-agents.json");
    let mut catalog: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    catalog["sessions"][id]["updatedAt"] = json!(9_999_999_999_999u64);
    std::fs::write(&path, serde_json::to_vec(&catalog).unwrap()).unwrap();
    assert_eq!(host.read(id, None).await.unwrap()["createdAt"], thread["createdAt"]);
    catalog["sessions"][id].as_object_mut().unwrap().remove("createdAt");
    std::fs::write(&path, serde_json::to_vec(&catalog).unwrap()).unwrap();
    let expected = id.split('-').nth(1).unwrap().parse::<u64>().unwrap() as f64 / 1000.0;
    assert_eq!(host.read(id, None).await.unwrap()["createdAt"], json!(expected));
  }
  let _ = std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn conversation_pages_request_creation_order() {
  let (root, bridge, _) = fixture();
  bridge.list(None, false).await.unwrap();
  bridge.list(Some("next-page".into()), false).await.unwrap();
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  let pages: Vec<_> = requests.iter().filter(|request| request["method"] == "thread/list").collect();
  assert_eq!(pages.len(), 2);
  for page in &pages {
    assert_eq!(page["params"]["sortKey"], "created_at");
    assert_eq!(page["params"]["sortDirection"], "desc");
  }
  assert_eq!(pages[1]["params"]["cursor"], "next-page");
  drop(bridge); let _ = std::fs::remove_dir_all(root);
}
#[cfg(unix)]
fn fixture() -> (PathBuf, CodexConversations, Arc<Mutex<Vec<Value>>>) {
  use std::os::unix::fs::PermissionsExt;
  static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
  let sequence = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
  let root = PathBuf::from("/private/tmp").join(format!("workbench-codex-test-{}-{}-{sequence}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
  std::fs::create_dir_all(&root).unwrap();
  let script = root.join("codex");
  std::fs::write(&script, include_str!("fixtures/fake_codex.py")).unwrap();
  std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
  let events = Arc::new(Mutex::new(Vec::new()));
  let sink = events.clone();
  let bridge = CodexConversations::new(script.to_string_lossy().into(), root.clone(), Arc::new(move |e| sink.lock().unwrap().push(e)));
  (root, bridge, events)
}

#[tokio::test]
async fn codex_dynamic_tool_uses_the_nooki_capability_bridge() {
  let (root, unused, _) = fixture(); drop(unused);
  let (events, mut receiver) = tokio::sync::mpsc::unbounded_channel();
  let capabilities = Arc::new(CapabilityBridge::new(&root, Arc::new(move |event| { let _ = events.send(event); })).unwrap());
  capabilities.renderer_ready();
  let bridge = Arc::new(CodexConversations::new(root.join("codex").to_string_lossy().into(), root.clone(), Arc::new(|_| {})).with_capability_bridge(capabilities.clone()));
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap().to_string();
  assert_eq!(bridge.read(&id, None).await.unwrap()["capabilityTools"], "available");
  let responder = capabilities.clone();
  let handled = tokio::spawn(async move {
    let event = receiver.recv().await.unwrap();
    assert_eq!(event["request"]["action"], "search");
    assert_eq!(event["request"]["invocationId"], "tool-call-1");
    assert_eq!(event["request"]["context"], json!({"threadId":"session-1","turnId":"turn-1","agent":"codex"}));
    responder.respond(event["id"].as_str().unwrap(), json!({"ok":true,"action":"search","commands":[]})).unwrap();
  });
  bridge.run(&id, "capability-tool", "", "request-tool", CancellationToken::new()).await.unwrap();
  handled.await.unwrap();
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  let started = requests.iter().find(|request| request["method"] == "thread/start").unwrap();
  assert_eq!(started["params"]["dynamicTools"][0]["name"], "nooki_capabilities");
  assert!(started["params"]["dynamicTools"][0]["description"].as_str().unwrap().contains("when relevant to the user's request"));
  assert!(!started["params"]["developerInstructions"].as_str().unwrap().contains("nooki_capabilities"));
  let response = requests.iter().find(|request| request["id"] == 9001 && request.get("method").is_none()).unwrap();
  assert_eq!(response["result"]["success"], true);
  drop(bridge); drop(capabilities); let _ = std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn native_sessions_stream_resume_and_recover_completed_turns_without_duplicate_generation() {
  let (root, bridge, events) = fixture();
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap();
  assert!(bridge.read(id, None).await.unwrap()["turns"].as_array().unwrap().is_empty());
  let first = bridge.run(id,"hello","sources","request-1",CancellationToken::new()).await.unwrap();
  let again = bridge.run(id,"hello","sources","request-1",CancellationToken::new()).await.unwrap();
  assert_eq!(first, again);
  bridge.run(id,"follow up","","request-2",CancellationToken::new()).await.unwrap();
  let history = bridge.read(id,None).await.unwrap();
  assert_eq!(history["turns"].as_array().unwrap().len(),2);
  assert_eq!(history["turns"][0]["items"][1]["content"],json!([]));
  assert!(events.lock().unwrap().iter().any(|e|e["method"]=="item/agentMessage/delta"));
  assert!(events.lock().unwrap().iter().filter(|e|e["params"]["item"]["type"]=="reasoning").all(|e|e["params"]["item"]["content"]==json!([])));
  drop(bridge);
  let reopened = CodexConversations::new(root.join("codex").to_string_lossy().into(),root.clone(),Arc::new(|_|{}));
  assert_eq!(reopened.list(None, false).await.unwrap()["data"].as_array().unwrap().len(),1);
  assert_eq!(reopened.run(id,"hello","","request-1",CancellationToken::new()).await.unwrap(),first);
  assert!(reopened.read("unrelated",None).await.is_err());
  drop(reopened); let _=std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn thread_history_paginates_without_requesting_unsupported_turn_listing() {
  let (root, bridge, _) = fixture();
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap();
  std::fs::write(root.join("conversation-workspace/list-turns-unsupported"), "").unwrap();
  let first = bridge.run(id, "hello", "", "request-1", CancellationToken::new()).await.unwrap();
  assert_eq!(bridge.read(id, None).await.unwrap()["turns"][0]["id"], "turn-1");
  assert_eq!(bridge.reconnect(id, "request-1", CancellationToken::new()).await.unwrap(), first);
  for index in 2..=31 {
    bridge.run(id, "follow up", "", &format!("request-{index}"), CancellationToken::new()).await.unwrap();
  }
  let latest = bridge.read(id, None).await.unwrap();
  assert_eq!(latest["turns"].as_array().unwrap().len(), 30);
  assert_eq!(latest["turns"][0]["id"], "turn-2");
  assert_eq!(latest["turns"][29]["id"], "turn-31");
  let older = bridge.read(id, latest["nextCursor"].as_str().map(str::to_owned)).await.unwrap();
  assert_eq!(older["turns"].as_array().unwrap().len(), 1);
  assert_eq!(older["turns"][0]["id"], "turn-1");
  assert!(older["nextCursor"].is_null());
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  assert_eq!(requests.iter().filter(|request| request["method"] == "turn/start").count(), 31);
  assert!(requests.iter().any(|request| request["method"] == "thread/read" && request["params"]["includeTurns"] == true));
  assert!(!requests.iter().any(|request| request["method"] == "thread/turns/list"));
  drop(bridge); let _ = std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn active_turn_does_not_request_an_unsupported_listing_endpoint() {
  let (root, bridge, events) = fixture(); let bridge = Arc::new(bridge);
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap().to_string();
  std::fs::write(root.join("conversation-workspace/list-turns-unsupported"), "").unwrap();
  let running = bridge.clone(); let session = id.clone();
  let handle = tokio::spawn(async move { running.run(&session, "slow", "", "active-1", CancellationToken::new()).await });
  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    while !events.lock().unwrap().iter().any(|event| event["method"] == "turn/started") { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
  }).await.unwrap();
  assert_eq!(bridge.read(&id, None).await.unwrap()["turns"][0]["status"], "inProgress");
  assert!(!handle.is_finished(), "The active turn must stay observable");
  std::fs::write(root.join("conversation-workspace/finish-background"), "").unwrap();
  let result = tokio::time::timeout(std::time::Duration::from_secs(5), handle).await.unwrap().unwrap().unwrap();
  assert_eq!(result["turnId"], "turn-1");
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  assert_eq!(requests.iter().filter(|request| request["method"] == "turn/start").count(), 1);
  assert!(!requests.iter().any(|request| request["method"] == "thread/turns/list"), "Nooki must not call an unsupported app-server method");
  drop(bridge); let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn newly_started_turn_completes_from_events_without_reading_active_history() {
  let (root, bridge, events) = fixture(); let bridge = Arc::new(bridge);
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap().to_string();
  std::fs::write(root.join("conversation-workspace/active-turn-history-unavailable"), "").unwrap();
  std::fs::write(root.join("conversation-workspace/list-turns-unsupported"), "").unwrap();
  let running = bridge.clone(); let session = id.clone();
  let handle = tokio::spawn(async move { running.run(&session, "slow", "", "active-2", CancellationToken::new()).await });
  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    while !events.lock().unwrap().iter().any(|event| event["method"] == "turn/started") { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
  }).await.unwrap();
  tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  assert!(!handle.is_finished(), "An active turn must not depend on reading retained history");
  std::fs::write(root.join("conversation-workspace/finish-background"), "").unwrap();
  let result = tokio::time::timeout(std::time::Duration::from_secs(5), handle).await.unwrap().unwrap().unwrap();
  assert_eq!(result["turnId"], "turn-1");
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  assert_eq!(requests.iter().filter(|request| request["method"] == "turn/start").count(), 1);
  drop(bridge); let _ = std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn cancel_interrupts_codex_and_retry_never_replays_a_failed_prompt() {
  let (root, bridge, _) = fixture(); let bridge=Arc::new(bridge);
  let thread=bridge.create().await.unwrap();let id=thread["id"].as_str().unwrap().to_string();
  let token=CancellationToken::new();let run_token=token.clone();let running=bridge.clone();let session=id.clone();
  let handle=tokio::spawn(async move{running.run(&session,"slow","","request-1",run_token).await});
  tokio::time::sleep(std::time::Duration::from_millis(100)).await;token.cancel();
  assert!(handle.await.unwrap().unwrap_err().contains("cancelled"));
  assert_eq!(bridge.read(&id,None).await.unwrap()["turns"][0]["status"],"interrupted");
  let other=bridge.create().await.unwrap();let other_id=other["id"].as_str().unwrap();
  assert!(bridge.run(other_id,"fail-once","","request-2",CancellationToken::new()).await.is_err());
  assert!(bridge.run(other_id,"fail-once","","request-2",CancellationToken::new()).await.is_err());
  assert_eq!(bridge.read(other_id, None).await.unwrap()["turns"].as_array().unwrap().len(), 1);
  bridge.run(other_id,"Continue the previous task","","request-3",CancellationToken::new()).await.unwrap();
  drop(bridge);let _=std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn daemon_failure_is_visible_and_reconnect_never_replays_the_prompt() {
  let (root,bridge,_)=fixture();let thread=bridge.create().await.unwrap();let id=thread["id"].as_str().unwrap();
  assert!(bridge.run(id,"disconnect","","request-1",CancellationToken::new()).await.is_err());
  // A transport close can precede process exit; wait for the simulated crashed daemon to exit.
  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    while std::os::unix::net::UnixStream::connect(root.join("codex.sock")).is_ok() { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
  }).await.unwrap();
  let error = bridge.reconnect(id,"request-1",CancellationToken::new()).await.unwrap_err();
  assert!(error.contains("interrupted"), "{error}");
  assert!(bridge.run(id,"disconnect","","request-1",CancellationToken::new()).await.is_err());
  assert_eq!(bridge.read(id,None).await.unwrap()["turns"].as_array().unwrap().len(),1);
  drop(bridge);let _=std::fs::remove_dir_all(root);
}
#[test]
fn platform_source_snapshots_are_immutable_and_cannot_read_unselected_documents() {
  let (root,bridge,_)=fixture();
  let publication=DocumentPublication{key:"entry".into(),title:"Original".into(),collection_key:"entries".into(),collection_name:"Journal".into(),document_date:"2026-09-08".into(),content:"first revision".into()};
  let doc=document_library::publish_document(&root,"test.diary","Diary",publication.clone()).unwrap();
  let sources=source_snapshots::capture(&root,"snapshot-1",std::slice::from_ref(&doc.id)).unwrap();
  let mut changed=publication;changed.content="second revision".into();document_library::publish_document(&root,"test.diary","Diary",changed).unwrap();
  assert_eq!(source_snapshots::capture(&root,"snapshot-1",std::slice::from_ref(&doc.id)).unwrap()[0].content,"first revision");
  assert_eq!(sources[0].reference["snapshotId"],"snapshot-1");
  assert!(source_snapshots::source(&root,"snapshot-1","other/document").is_err());
  assert!(source_snapshots::capture(&root,"../escape",&[]).is_err());
  assert!(source_snapshots::capture(&root,"snapshot-1",&[]).is_err());
  drop(bridge);let _=std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn document_turns_edit_working_copies_and_retain_outputs_across_followups_and_restart() {
  let (root, bridge, _) = fixture();
  let publication = DocumentPublication { key:"entry".into(), title:"Library original".into(), collection_key:"entries".into(), collection_name:"Journal".into(), document_date:"2026-09-09".into(), content:"Original Library text".into() };
  let original = document_library::publish_document(&root, "test.diary", "Diary", publication).unwrap();
  source_snapshots::capture(&root, "snapshot-edit", std::slice::from_ref(&original.id)).unwrap();
  let inputs = DocumentInputs { snapshot_id: Some("snapshot-edit".into()), uploads: vec![Attachment { id:"upload-1".into(), name:"附件.txt".into(), content:"Uploaded text".into() }] };
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap();
  let first = bridge.run_with_documents(id, "revise-documents", "", "edit-1", &inputs, &[], CancellationToken::new()).await.unwrap();
  let artifacts = first["artifacts"].as_array().unwrap();
  assert_eq!(artifacts.len(), 2);
  assert!(artifacts.iter().any(|a| a["name"] == "附件.txt" && a["content"] == "Uploaded text\nEdited by fixture"));
  assert!(artifacts.iter().any(|a| a["source"]["documentId"] == original.id && a["before"] == "Original Library text"));
  assert_eq!(document_library::read_document(&root, &original.id).unwrap().content, "Original Library text");
  let second = bridge.run_with_documents(id, "revise-documents", "", "edit-2", &inputs, &[], CancellationToken::new()).await.unwrap();
  assert!(second["artifacts"].as_array().unwrap().iter().all(|a| a["content"].as_str().unwrap().ends_with("Edited by fixture\nEdited by fixture")));
  let other = bridge.create().await.unwrap(); let other_id = other["id"].as_str().unwrap();
  let new_document = bridge.run(other_id, "write-document", "", "new-1", CancellationToken::new()).await.unwrap();
  assert_eq!(new_document["artifacts"].as_array().unwrap().len(), 1);
  assert!(new_document["artifacts"][0]["before"].is_null());
  assert_ne!(conversation_documents::workspace(&root, id), conversation_documents::workspace(&root, other_id));
  assert_eq!(bridge.list(None, false).await.unwrap()["data"].as_array().unwrap().len(), 2);
  let requests: Vec<Value> = std::fs::read_to_string(root.join("conversation-workspace/fake-requests.jsonl")).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
  for request in requests.iter().filter(|r| r["method"] == "turn/start") {
    let p = &request["params"];
    let expected = conversation_documents::workspace(&root, p["threadId"].as_str().unwrap()).canonicalize().unwrap();
    assert_eq!(p["cwd"], expected.to_str().unwrap());
    assert_eq!(p["sandboxPolicy"], json!({"type":"workspaceWrite","writableRoots":[expected],"networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true}));
    assert_eq!(p["approvalPolicy"], "never");
  }
  drop(bridge);
  let reopened = CodexConversations::new(root.join("codex").to_string_lossy().into(), root.clone(), Arc::new(|_| {}));
  let recovered = reopened.run_with_documents(id, "revise-documents", "", "edit-1", &inputs, &[], CancellationToken::new()).await.unwrap();
  assert_eq!(recovered, first);
  assert_eq!(reopened.read(id, None).await.unwrap()["turns"].as_array().unwrap().len(), 2);
  drop(reopened); let _ = std::fs::remove_dir_all(root);
}

#[test]
fn document_preparation_rejects_invalid_attachments_and_linked_outputs() {
  let (root, bridge, _) = fixture();
  for (name, content) in [("../escape.md", "text"), ("data.docx", "text"), ("binary.txt", "a\0b")] {
    let inputs = DocumentInputs { snapshot_id: None, uploads: vec![Attachment { id:"upload".into(), name:name.into(), content:content.into() }] };
    assert!(conversation_documents::prepare(&root, "one", "request", &inputs).is_err());
  }
  conversation_documents::prepare(&root, "one", "valid", &DocumentInputs::default()).unwrap();
  #[cfg(unix)] {
    let outside = root.join("outside.md"); std::fs::write(&outside, "Private outside text").unwrap();
    std::os::unix::fs::symlink(outside, conversation_documents::workspace(&root, "one").join("linked.md")).unwrap();
    assert!(conversation_documents::complete(&root, "one", "valid").unwrap_err().contains("regular files"));
  }
  drop(bridge); let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn archive_restore_and_delete_persist_and_reject_unowned_or_running_sessions() {
  use app_lib::codex_conversations::ConversationAction::{Archive, Restore, Delete};
  let (root, bridge, _) = fixture();
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap();
  bridge.run(id, "keep this", "", "archive-1", CancellationToken::new()).await.unwrap();
  assert!(bridge.change(id, Delete).await.unwrap_err().contains("Only archived"));
  assert!(bridge.change("unrelated", Archive).await.is_err());
  bridge.change(id, Archive).await.unwrap();
  assert_eq!(bridge.list(None, false).await.unwrap()["data"], json!([]));
  assert_eq!(bridge.list(None, true).await.unwrap()["data"][0]["id"], id);
  drop(bridge);
  let reopened = CodexConversations::new(root.join("codex").to_string_lossy().into(), root.clone(), Arc::new(|_| {}));
  assert_eq!(reopened.list(None, true).await.unwrap()["data"][0]["id"], id);
  reopened.change(id, Restore).await.unwrap();
  assert_eq!(reopened.read(id, None).await.unwrap()["turns"].as_array().unwrap().len(), 1);
  reopened.change(id, Archive).await.unwrap();
  reopened.change(id, Delete).await.unwrap();
  assert_eq!(reopened.list(None, true).await.unwrap()["data"], json!([]));
  assert!(reopened.read(id, None).await.is_err());
  drop(reopened);
  let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn archive_refuses_a_running_turn() {
  use app_lib::codex_conversations::ConversationAction::Archive;
  let (root, bridge, events) = fixture(); let bridge = Arc::new(bridge);
  let thread = bridge.create().await.unwrap(); let id = thread["id"].as_str().unwrap().to_string();
  let token = CancellationToken::new(); let cancelled = token.clone(); let running = bridge.clone(); let session = id.clone();
  let handle = tokio::spawn(async move { running.run(&session, "slow", "", "archive-running", cancelled).await });
  tokio::time::timeout(std::time::Duration::from_secs(5), async {
    loop { if events.lock().unwrap().iter().any(|e| e["method"] == "turn/started") { break; } tokio::task::yield_now().await; }
  }).await.unwrap();
  assert!(bridge.change(&id, Archive).await.unwrap_err().contains("finish"));
  token.cancel(); assert!(handle.await.unwrap().is_err());
  drop(bridge); let _ = std::fs::remove_dir_all(root);
}
