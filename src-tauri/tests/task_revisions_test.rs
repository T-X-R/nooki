use app_lib::task_goals::GoalWorker;
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::atomic::{AtomicU64, Ordering}};

fn fixture() -> (PathBuf, GoalWorker) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!("nooki-task-revisions-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    fs::create_dir_all(&root).unwrap();
    let worker = GoalWorker::new(root.clone(), "/missing-agent-must-not-start".into());
    (root, worker)
}
fn draft(id: &str) -> Value { json!({"id":id,"title":"Review notes","description":"Synthetic only","status":"todo"}) }
async fn read(worker: &mut GoalWorker) -> Value { worker.command(json!({"op":"read"})).await.unwrap() }
async fn save(worker: &mut GoalWorker, board: Value) -> Value { worker.command(json!({"op":"legacy","board":board})).await.unwrap() }

#[tokio::test]
async fn old_boards_gain_stable_revisions_without_rewriting_on_read() {
    let (root, mut worker) = fixture();
    let original = serde_json::to_vec(&json!({"cards":[draft("first"),draft("second")]})).unwrap();
    fs::write(root.join("task-board.json"), &original).unwrap();
    let board = read(&mut worker).await;
    assert!(board["cards"][0]["revision"].as_u64().is_some_and(|r| r > 0));
    assert_ne!(board["cards"][0]["revision"], board["cards"][1]["revision"]);
    assert_eq!(read(&mut worker).await, board);
    assert_eq!(fs::read(root.join("task-board.json")).unwrap(), original);
    assert_eq!(save(&mut worker, board.clone()).await["cards"], board["cards"]);
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn only_changed_cards_advance_and_renderer_cannot_choose_revisions() {
    let (root, mut worker) = fixture();
    let first = save(&mut worker, json!({"cards":[draft("first"),draft("second")]})).await;
    let mut edited = first.clone(); edited["cards"][0]["title"] = json!("User edit");
    edited["cards"][0]["revision"] = json!(999); edited["revisionSequence"] = json!(999);
    let next = save(&mut worker, edited).await;
    assert_eq!(next["cards"][0]["revision"], 3);
    assert_eq!(next["cards"][1]["revision"], first["cards"][1]["revision"]);
    assert_eq!(next["revisionSequence"], 3);
    assert_eq!(save(&mut worker, next.clone()).await["cards"], next["cards"]);
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn deletion_and_restart_do_not_recycle_a_selected_revision() {
    let (root, mut worker) = fixture();
    let first = save(&mut worker, json!({"cards":[draft("same-id")]})).await;
    let mut empty = first.clone(); empty["cards"] = json!([]); save(&mut worker, empty).await;
    drop(worker); let mut worker = GoalWorker::new(root.clone(), "/missing-agent".into());
    let mut recreated = read(&mut worker).await; recreated["cards"] = json!([draft("same-id")]);
    let next = save(&mut worker, recreated).await;
    assert!(next["cards"][0]["revision"].as_u64().unwrap() > first["cards"][0]["revision"].as_u64().unwrap());
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn native_goal_commands_advance_the_same_revision_contract() {
    let (root, mut worker) = fixture();
    let added = worker.command(json!({"op":"add","id":"goal","title":"Native task","description":"Do not run","sources":[],"cwd":""})).await.unwrap();
    let before = added["cards"][0]["revision"].as_u64().unwrap();
    let paused = worker.command(json!({"op":"queue-pause","paused":true})).await.unwrap();
    assert_eq!(paused["cards"][0]["revision"], before);
    let stopped = worker.command(json!({"op":"stop","id":"goal"})).await.unwrap();
    assert!(stopped["cards"][0]["revision"].as_u64().unwrap() > before);
    assert!(stopped["cards"][0].get("threadId").is_none());
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn failed_save_keeps_committed_revisions_and_retry_advances_once() {
    let (root, mut worker) = fixture();
    let first = save(&mut worker, json!({"cards":[draft("first")]})).await;
    let bytes = fs::read(root.join("task-board.json")).unwrap();
    let mut edit = first.clone(); edit["cards"][0]["title"] = json!("Changed");
    fs::create_dir(root.join("task-board.pending")).unwrap();
    assert!(worker.command(json!({"op":"legacy","board":edit})).await.is_err());
    assert_eq!(fs::read(root.join("task-board.json")).unwrap(), bytes);
    fs::remove_dir(root.join("task-board.pending")).unwrap();
    assert_eq!(save(&mut worker, edit).await["cards"][0]["revision"], 2);
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn malformed_persisted_revision_metadata_is_rejected() {
    let (root, mut worker) = fixture();
    for (revision, sequence) in [(json!(0),json!(1)), (json!(2),json!(1)), (json!("1"),json!(1)), (json!(1),json!(9_007_199_254_740_992_u64))] {
        let mut card = draft("first"); card["revision"] = revision;
        fs::write(root.join("task-board.json"), serde_json::to_vec(&json!({"cards":[card],"revisionSequence":sequence})).unwrap()).unwrap();
        assert!(worker.command(json!({"op":"read"})).await.is_err());
    }
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn exhausted_sequence_allows_unchanged_saves_but_rejects_edits_atomically() {
    let (root, mut worker) = fixture();
    let mut card = draft("first"); card["revision"] = json!(9_007_199_254_740_991_u64);
    fs::write(root.join("task-board.json"), serde_json::to_vec(&json!({"cards":[card],"revisionSequence":9_007_199_254_740_991_u64})).unwrap()).unwrap();
    let board = read(&mut worker).await;
    let mut edited = save(&mut worker, board.clone()).await;
    let bytes = fs::read(root.join("task-board.json")).unwrap();
    edited["cards"][0]["title"] = json!("Changed");
    assert!(worker.command(json!({"op":"legacy","board":edited})).await.unwrap_err().contains("RESOURCE_LIMIT"));
    assert_eq!(fs::read(root.join("task-board.json")).unwrap(), bytes);
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn restore_advances_changed_goals_and_preserves_unchanged_drafts() {
    use app_lib::user_data;
    let (root, mut worker) = fixture();
    let draft_board = save(&mut worker, json!({"cards":[draft("draft")]})).await;
    let board = worker.command(json!({"op":"add","id":"goal","title":"Native task","description":"Do not run","sources":[],"cwd":""})).await.unwrap();
    let backup = user_data::capture(&root, Default::default(), json!([])).unwrap();
    user_data::restore(&root, &backup, "restore-revisions").unwrap();
    let restored = read(&mut worker).await;
    assert_eq!(restored["cards"][0], draft_board["cards"][0]);
    assert_eq!(restored["cards"][1]["status"], "paused");
    assert!(restored["cards"][1]["revision"].as_u64().unwrap() > board["cards"][1]["revision"].as_u64().unwrap());
    assert_eq!(restored["revisionSequence"], restored["cards"][1]["revision"]);
    drop(worker); fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn native_storage_helper_shares_the_worker_sequence() {
    let (root, mut worker) = fixture();
    let state = app_lib::capability_runtime::PlatformState::load(root.clone()).unwrap();
    let first = save(&mut worker, json!({"cards":[draft("first")]})).await;
    let mut edited = first.clone(); edited["cards"][0]["title"] = json!("Native helper edit");
    edited["cards"][0]["revision"] = json!(999); edited["revisionSequence"] = json!(999);
    state.write_task_board(&edited).unwrap();
    let next = state.read_task_board().unwrap();
    assert_eq!(next, read(&mut worker).await);
    assert_eq!(next["cards"][0]["revision"], 2);
    assert_eq!(next["revisionSequence"], 2);
    drop(worker); drop(state); fs::remove_dir_all(root).unwrap();
}
