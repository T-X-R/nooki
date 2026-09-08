use app_lib::{codex_conversations::CodexConversations, source_snapshots, document_library::{self, DocumentPublication}};
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
