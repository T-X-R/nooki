use app_lib::task_goals::{project_status, execution_params, verify_execution};
use serde_json::json;

#[test]
fn completion_waits_for_the_final_turn_and_pause_differs_from_stop() {
    assert_eq!(project_status("complete", true, "run", false), "running");
    assert_eq!(project_status("complete", false, "run", false), "review");
    assert_eq!(project_status("paused", true, "pause", false), "pausing");
    assert_eq!(project_status("paused", false, "pause", false), "paused");
    assert_eq!(project_status("paused", true, "stop", false), "stopping");
    assert_eq!(project_status("paused", false, "stop", false), "stopped");
    assert_eq!(project_status("blocked", false, "run", false), "blocked");
    assert_eq!(project_status("active", true, "run", true), "question");
}

#[test]
fn resume_restores_and_checks_the_original_execution_contract() {
    let saved = json!({"cwd":"/work/project","model":"fixture-model","approvalPolicy":"on-request","sandbox":"workspace-write","config":{"features.goals":true,"sandbox_workspace_write.network_access":true},"actualSandbox":{"type":"workspaceWrite","writableRoots":["/work/project"],"networkAccess":true}});
    let params = execution_params(&saved, Some("thread-1"));
    assert_eq!(params["cwd"], "/work/project");
    assert_eq!(params["model"], "fixture-model");
    assert_eq!(params["sandbox"], "workspace-write");
    assert_eq!(params["approvalPolicy"], "on-request");
    assert_eq!(params["config"], saved["config"]);
    assert!(verify_execution(&saved, &json!({"thread":{"cwd":"/work/project"},"model":"fixture-model","approvalPolicy":"on-request","sandbox":{"type":"readOnly","networkAccess":false}})).is_err());
    assert!(verify_execution(&saved, &json!({"thread":{"cwd":"/work/project"},"model":"fixture-model","approvalPolicy":"on-request","sandbox":saved["actualSandbox"]})).is_ok());
}

use app_lib::task_goals::GoalWorker;
use serde_json::Value;
use std::{fs, path::PathBuf, time::Duration};
fn fixture() -> (PathBuf, GoalWorker) {
    use std::os::unix::fs::PermissionsExt;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let root = PathBuf::from(format!("/tmp/nooki-goals-test-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    fs::create_dir_all(&root).unwrap();
    let binary = root.join("codex");
    fs::write(&binary, include_str!("fixtures/fake_codex.py")).unwrap();
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
    let worker = GoalWorker::new(root.clone(), binary.to_string_lossy().into());
    (root, worker)
}
async fn read(worker: &mut GoalWorker) -> Value { worker.command(json!({"op":"read"})).await.unwrap() }
async fn add(worker: &mut GoalWorker, id: &str) {
    worker.command(json!({"op":"add","id":id,"title":"Write a document","description":"Use native Goals","sources":[],"cwd":""})).await.unwrap();
}
async fn finish(root: &std::path::Path, thread: &Value) {
    let path = root.join("goal-runtime/conversation-workspace/finish-goal-turn");
    fs::write(&path, thread.as_str().unwrap()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async { while path.exists() { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.unwrap();
}
#[tokio::test]
async fn native_continuation_pause_restart_stop_and_delivery() {
    let (root, mut worker) = fixture();
    add(&mut worker, "first").await; add(&mut worker, "second").await;
    worker.tick().await.unwrap();
    let board = read(&mut worker).await; let tid = board["cards"][0]["threadId"].clone();
    assert_eq!(board["cards"][1]["status"], "queued");
    let paused = worker.command(json!({"op":"pause","id":"first"})).await.unwrap();
    assert_eq!(paused["cards"][0]["status"], "pausing");
    finish(&root, &tid).await;
    worker.tick().await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["status"], "paused");
    // Queue pickup is independent from a goal pause; second task now owns the slot.
    worker.command(json!({"op":"stop","id":"second"})).await.unwrap();
    worker.tick().await.unwrap();
    drop(worker);
    let mut worker = GoalWorker::new(root.clone(), root.join("codex").to_string_lossy().into());
    worker.tick().await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["status"], "paused");
    worker.command(json!({"op":"resume","id":"first"})).await.unwrap();
    worker.tick().await.unwrap();
    finish(&root, &tid).await; // Native runtime automatically starts another turn.
    let history = worker.command(json!({"op":"history","id":"first"})).await.unwrap();
    assert_eq!(history["turns"].as_array().unwrap().len(), 3);
    let stopped = worker.command(json!({"op":"stop","id":"first"})).await.unwrap();
    assert_eq!(stopped["cards"][0]["status"], "stopped");
    assert_eq!(stopped["cards"][0]["activeTurn"], false);
    let trace = fs::read_to_string(root.join("goal-runtime/conversation-workspace/fake-requests.jsonl")).unwrap();
    let calls: Vec<Value> = trace.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert!(!calls.iter().any(|r| r["method"] == "turn/start" || r["method"] == "turn/steer"));
    let resume = calls.iter().find(|r| r["method"] == "thread/resume").unwrap();
    assert_eq!(resume["params"]["sandbox"], "workspace-write");
    assert_eq!(resume["params"]["model"], "fixture-model");
    assert_eq!(resume["params"]["approvalPolicy"], "on-request");
    assert_eq!(resume["params"]["config"]["features.goals"], true);
    drop(worker); fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn stale_legacy_writes_cannot_replace_goals_and_native_approvals_are_forwarded() {
    let (root, mut worker) = fixture();
    let runtime = root.join("goal-runtime/conversation-workspace"); fs::create_dir_all(&runtime).unwrap();
    fs::write(runtime.join("goal-request-approval"), "").unwrap();
    add(&mut worker, "first").await; worker.tick().await.unwrap(); worker.tick().await.unwrap();
    let board = read(&mut worker).await;
    assert_eq!(board["cards"][0]["requests"][0]["id"], 9900);
    assert!(worker.command(json!({"op":"legacy","board":{"cards":[{"id":"old-draft","title":"Legacy draft","description":"Keep original scope","status":"running","authorization":{"snapshotId":"legacy","documentIds":[]}}]}})).await.is_err(), "A stale renderer cannot claim the occupied native queue slot");
    let updated = worker.command(json!({"op":"legacy","board":{"cards":[]}})).await.unwrap();
    assert_eq!(updated["cards"].as_array().unwrap().len(), 1);
    assert_eq!(updated["cards"][0]["status"], "question");
    worker.command(json!({"op":"reply","id":"first","requestId":9900,"decision":"decline"})).await.unwrap();
    assert!(worker.command(json!({"op":"reply","id":"first","requestId":9900,"decision":"accept"})).await.is_err());
    worker.command(json!({"op":"stop","id":"first"})).await.unwrap();
    drop(worker); fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn mismatched_restored_permissions_never_reactivate_the_goal() {
    let (root, mut worker) = fixture(); add(&mut worker,"first").await; worker.tick().await.unwrap();
    worker.command(json!({"op":"stop","id":"first"})).await.unwrap(); drop(worker);
    fs::write(root.join("goal-runtime/conversation-workspace/wrong-goal-policy"), "").unwrap();
    let mut worker = GoalWorker::new(root.clone(), root.join("codex").to_string_lossy().into());
    assert!(worker.command(json!({"op":"resume","id":"first"})).await.is_err());
    let trace = fs::read_to_string(root.join("goal-runtime/conversation-workspace/fake-requests.jsonl")).unwrap();
    assert_eq!(trace.lines().map(|l| serde_json::from_str::<Value>(l).unwrap()).filter(|r| r["method"] == "thread/goal/set" && r["params"]["status"] == "active").count(), 1);
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn final_turn_barrier_immutable_delivery_feedback_and_restored_queue() {
    let (root, mut worker) = fixture(); add(&mut worker,"first").await; worker.tick().await.unwrap();
    let board = read(&mut worker).await; let tid = board["cards"][0]["threadId"].clone();
    let marker = root.join("goal-runtime/conversation-workspace/complete-goal");
    fs::write(&marker, tid.as_str().unwrap()).unwrap();
    while marker.exists() { tokio::time::sleep(Duration::from_millis(10)).await; }
    worker.tick().await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["status"], "running");
    assert!(worker.command(json!({"op":"accept","id":"first"})).await.is_err());
    let output = root.join("task-outputs/first/report.md"); fs::write(&output, "original delivery").unwrap();
    finish(&root, &tid).await; worker.tick().await.unwrap();
    let delivered = read(&mut worker).await;
    assert_eq!(delivered["cards"][0]["status"], "review");
    assert_eq!(delivered["cards"][0]["delivery"]["artifacts"][0]["content"], "original delivery");
    fs::write(&output, "changed after delivery").unwrap(); worker.tick().await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["delivery"], delivered["cards"][0]["delivery"]);
    worker.command(json!({"op":"feedback","id":"first","message":"Add the missing evidence"})).await.unwrap();
    worker.tick().await.unwrap(); worker.tick().await.unwrap();
    assert!(fs::read_to_string(root.join("task-inputs/first.md")).unwrap().contains("Add the missing evidence"));
    assert!(read(&mut worker).await["cards"][0]["goal"]["objective"].as_str().unwrap().contains("revision 1"));
    let backup = app_lib::user_data::capture(&root, Default::default(), json!([])).unwrap();
    assert!(app_lib::user_data::restore(&root, &backup, "restore-active").is_err());
    worker.command(json!({"op":"stop","id":"first"})).await.unwrap();
    app_lib::user_data::restore(&root, &backup, "restore-paused").unwrap();
    worker.tick().await.unwrap();
    let restored = read(&mut worker).await;
    assert_eq!(restored["paused"], true);
    assert_eq!(restored["cards"][0]["status"], "paused");
    assert_eq!(restored["cards"][0]["restored"], true);
    worker.command(json!({"op":"queue-pause","paused":false})).await.unwrap(); worker.tick().await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["status"], "paused", "Enabling pickup does not reactivate imported goals");
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn task_conversation_exposes_native_history_and_routes_user_messages_to_its_owner() {
    let (root, mut worker) = fixture(); add(&mut worker,"first").await; worker.tick().await.unwrap();
    let brief = fs::read_to_string(root.join("task-inputs/first.md")).unwrap();
    assert!(!brief.contains("## User feedback"));
    assert!(!brief.contains("## Reference material"));
    let history = worker.command(json!({"op":"history","id":"first"})).await.unwrap();
    assert_eq!(history["name"], "Write a document");
    assert_eq!(history["task"]["id"], "first");
    worker.command(json!({"op":"message","id":"first","message":"Please include sources","messageId":"followup-one"})).await.unwrap();
    let history = worker.command(json!({"op":"history","id":"first"})).await.unwrap();
    assert_eq!(history["turns"].as_array().unwrap().len(), 1);
    assert!(history["turns"][0]["items"].as_array().unwrap().iter().any(|i| i["clientId"] == "followup-one"));
    worker.command(json!({"op":"stop","id":"first"})).await.unwrap();
    worker.command(json!({"op":"message","id":"first","message":"Revise the report","messageId":"followup-two"})).await.unwrap();
    worker.tick().await.unwrap();
    assert_eq!(fs::read_to_string(root.join("task-inputs/first.md")).unwrap(), brief);
    let history = worker.command(json!({"op":"history","id":"first"})).await.unwrap();
    assert!(history["turns"].as_array().unwrap().iter().flat_map(|t| t["items"].as_array().unwrap()).any(|i| i["clientId"] == "followup-two"));
    worker.command(json!({"op":"stop","id":"first"})).await.unwrap();
    let trace = fs::read_to_string(root.join("goal-runtime/conversation-workspace/fake-requests.jsonl")).unwrap();
    let starts: Vec<Value> = trace.lines().map(|l| serde_json::from_str::<Value>(l).unwrap()).filter(|r| r["method"] == "turn/start").collect();
    assert_eq!(starts.len(), 1);
    assert_eq!(starts[0]["params"]["input"], json!([{"type":"text","text":"Revise the report"}]));
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn completed_task_chat_and_archive_preserve_goal_and_acceptance() {
    let (root, mut worker) = fixture(); add(&mut worker,"first").await; worker.tick().await.unwrap();
    assert!(worker.command(json!({"op":"archive","id":"first"})).await.is_err());
    let tid = read(&mut worker).await["cards"][0]["threadId"].clone();
    let marker = root.join("goal-runtime/conversation-workspace/complete-goal"); fs::write(&marker, tid.as_str().unwrap()).unwrap();
    while marker.exists() { tokio::time::sleep(Duration::from_millis(10)).await; }
    finish(&root, &tid).await; worker.tick().await.unwrap();
    let delivery = read(&mut worker).await["cards"][0]["delivery"].clone();
    worker.command(json!({"op":"message","id":"first","message":"Hello","messageId":"chat-before-acceptance"})).await.unwrap();
    worker.tick().await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["delivery"], delivery);
    worker.command(json!({"op":"accept","id":"first"})).await.unwrap();
    worker.command(json!({"op":"message","id":"first","message":"Hello","messageId":"chat-after-acceptance"})).await.unwrap();
    worker.tick().await.unwrap();
    let board = read(&mut worker).await;
    assert_eq!(board["cards"][0]["status"], "done");
    assert_eq!(board["cards"][0]["goal"]["status"], "complete");
    assert_eq!(board["cards"][0]["delivery"], delivery);
    worker.command(json!({"op":"archive","id":"first"})).await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["archived"], true);
    drop(worker);
    let mut worker = GoalWorker::new(root.clone(), root.join("codex").to_string_lossy().into());
    worker.tick().await.unwrap();
    let history = worker.command(json!({"op":"history","id":"first"})).await.unwrap();
    assert_eq!(history["archived"], true);
    assert!(worker.command(json!({"op":"message","id":"first","message":"Hello","messageId":"archived-message"})).await.is_err());
    worker.command(json!({"op":"unarchive","id":"first"})).await.unwrap();
    assert_eq!(read(&mut worker).await["cards"][0]["status"], "done");
    assert_eq!(read(&mut worker).await["cards"][0]["archived"], false);
    let trace = fs::read_to_string(root.join("goal-runtime/conversation-workspace/fake-requests.jsonl")).unwrap();
    let calls: Vec<Value> = trace.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(calls.iter().filter(|r| r["method"] == "thread/goal/set" && r["params"]["status"] == "active").count(), 1);
    assert_eq!(calls.iter().filter(|r| r["method"] == "turn/start").count(), 2);
    drop(worker); fs::remove_dir_all(root).unwrap();
}
