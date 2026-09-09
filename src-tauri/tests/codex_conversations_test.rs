use app_lib::{codex_conversations::CodexConversations, conversation_documents::{self, Attachment, DocumentInputs}, source_snapshots, document_library::{self, DocumentPublication}};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Arc, Mutex}};
use tokio_util::sync::CancellationToken;
#[cfg(unix)]
fn fixture() -> (PathBuf, CodexConversations, Arc<Mutex<Vec<Value>>>) {
  use std::os::unix::fs::PermissionsExt;
  static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
  let sequence = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
  let root = std::env::temp_dir().join(format!("workbench-codex-test-{}-{}-{sequence}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
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
  assert_eq!(reopened.list(None).await.unwrap()["data"].as_array().unwrap().len(),1);
  assert_eq!(reopened.run(id,"hello","","request-1",CancellationToken::new()).await.unwrap(),first);
  assert!(reopened.read("unrelated",None).await.is_err());
  drop(reopened); let _=std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn cancel_interrupts_codex_and_a_failed_turn_can_be_retried() {
  let (root, bridge, _) = fixture(); let bridge=Arc::new(bridge);
  let thread=bridge.create().await.unwrap();let id=thread["id"].as_str().unwrap().to_string();
  let token=CancellationToken::new();let run_token=token.clone();let running=bridge.clone();let session=id.clone();
  let handle=tokio::spawn(async move{running.run(&session,"slow","","request-1",run_token).await});
  tokio::time::sleep(std::time::Duration::from_millis(100)).await;token.cancel();
  assert!(handle.await.unwrap().unwrap_err().contains("cancelled"));
  assert_eq!(bridge.read(&id,None).await.unwrap()["turns"][0]["status"],"interrupted");
  let other=bridge.create().await.unwrap();let other_id=other["id"].as_str().unwrap();
  assert!(bridge.run(other_id,"fail-once","","request-2",CancellationToken::new()).await.is_err());
  bridge.run(other_id,"fail-once","","request-2",CancellationToken::new()).await.unwrap();
  drop(bridge);let _=std::fs::remove_dir_all(root);
}
#[tokio::test]
async fn connection_loss_is_visible_and_retry_uses_the_same_codex_session() {
  let (root,bridge,_)=fixture();let thread=bridge.create().await.unwrap();let id=thread["id"].as_str().unwrap();
  assert!(bridge.run(id,"disconnect","","request-1",CancellationToken::new()).await.unwrap_err().contains("disconnected"));
  bridge.run(id,"disconnect","","request-1",CancellationToken::new()).await.unwrap();
  assert_eq!(bridge.read(id,None).await.unwrap()["turns"].as_array().unwrap().len(),2);
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
  let first = bridge.run_with_documents(id, "revise-documents", "", "edit-1", &inputs, CancellationToken::new()).await.unwrap();
  let artifacts = first["artifacts"].as_array().unwrap();
  assert_eq!(artifacts.len(), 2);
  assert!(artifacts.iter().any(|a| a["name"] == "附件.txt" && a["content"] == "Uploaded text\nEdited by fixture"));
  assert!(artifacts.iter().any(|a| a["source"]["documentId"] == original.id && a["before"] == "Original Library text"));
  assert_eq!(document_library::read_document(&root, &original.id).unwrap().content, "Original Library text");
  let second = bridge.run_with_documents(id, "revise-documents", "", "edit-2", &inputs, CancellationToken::new()).await.unwrap();
  assert!(second["artifacts"].as_array().unwrap().iter().all(|a| a["content"].as_str().unwrap().ends_with("Edited by fixture\nEdited by fixture")));
  let other = bridge.create().await.unwrap(); let other_id = other["id"].as_str().unwrap();
  let new_document = bridge.run(other_id, "write-document", "", "new-1", CancellationToken::new()).await.unwrap();
  assert_eq!(new_document["artifacts"].as_array().unwrap().len(), 1);
  assert!(new_document["artifacts"][0]["before"].is_null());
  assert_ne!(conversation_documents::workspace(&root, id), conversation_documents::workspace(&root, other_id));
  assert_eq!(bridge.list(None).await.unwrap()["data"].as_array().unwrap().len(), 2);
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
  let recovered = reopened.run_with_documents(id, "revise-documents", "", "edit-1", &inputs, CancellationToken::new()).await.unwrap();
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
