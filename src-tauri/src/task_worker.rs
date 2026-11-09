//! Single task-board writer, independent of the desktop window.
use serde_json::{json, Value};
use std::{fs::{self, File, OpenOptions}, path::Path, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[cfg(unix)]
pub(crate) fn file_lock(path: &Path) -> Result<Option<File>, String> {
    use std::os::fd::AsRawFd;
    let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path).map_err(|e| e.to_string())?;
    // SAFETY: this owned descriptor stays open for the entire lock lifetime.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 { return Ok(Some(file)); }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock { Ok(None) } else { Err(error.to_string()) }
}
#[cfg(not(unix))]
pub(crate) fn file_lock(_: &Path) -> Result<Option<File>, String> { Err("Background tasks require Unix support".into()) }
pub(crate) fn data_lock(root: &Path) -> Result<Option<File>, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    file_lock(&root.join("task-data.lock"))
}

#[cfg(unix)]
fn board_busy(root: &Path) -> Result<bool, String> {
    let board = crate::task_goals::load(root)?;
    Ok(board["cards"].as_array().unwrap().iter().any(|card| {
        card["activeTurn"] == true || card["goal"]["status"] == "active"
            || matches!(card["status"].as_str(), Some("queued" | "running" | "question" | "pausing" | "stopping"))
    }))
}

#[cfg(target_os = "macos")]
pub(crate) async fn update_guard(root: &Path) -> Result<Option<File>, String> {
    let owner = root.join("task-worker.lock");
    if let Some(guard) = file_lock(&owner)? {
        return Ok((!board_busy(root)?).then_some(guard));
    }
    if request(root, json!({"op":"update_handoff"})).await? != true {
        return Ok(None);
    }
    for _ in 0..100 {
        if let Some(guard) = file_lock(&owner)? {
            return Ok((!board_busy(root)?).then_some(guard));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    Err("Task worker did not release ownership".into())
}
#[cfg(unix)]
pub async fn request(root: &Path, value: Value) -> Result<Value, String> {
    use std::os::unix::{fs::PermissionsExt, process::CommandExt};
    let socket = root.join("task-worker.sock");
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut launched = false;
    let stream = loop {
        match tokio::net::UnixStream::connect(&socket).await {
            Ok(stream) => break stream,
            Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused) && !launched => {
                let mut command = std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
                command.arg("--task-worker").arg(root).process_group(0).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(OpenOptions::new().create(true).append(true).open(root.join("task-worker.log")).map_err(|e| e.to_string())?);
                let mut child = command.spawn().map_err(|e| e.to_string())?;
                std::thread::spawn(move || { let _ = child.wait(); });
                launched = true;
                for _ in 0..100 {
                    if tokio::net::UnixStream::connect(&socket).await.is_ok() { break; }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
            Err(error) => return Err(format!("Task worker unavailable: {error}")),
        }
    };
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    let (reader, mut writer) = stream.into_split();
    writer.write_all(format!("{value}\n").as_bytes()).await.map_err(|e| e.to_string())?;
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(120), BufReader::new(reader).read_line(&mut line)).await.map_err(|_| "Task command timed out; refresh before retrying")?.map_err(|e| e.to_string())?;
    let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if let Some(error) = response["error"].as_str() { return Err(error.into()); }
    Ok(response["result"].clone())
}
#[cfg(not(unix))]
pub async fn request(_: &Path, _: Value) -> Result<Value, String> { Err("Background tasks require Unix support".into()) }
#[cfg(unix)]
pub async fn worker(root: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let Some(_owner) = file_lock(&root.join("task-worker.lock"))? else { return Ok(()); };
    let socket = root.join("task-worker.sock");
    if socket.exists() { fs::remove_file(&socket).map_err(|e| e.to_string())?; }
    let listener = tokio::net::UnixListener::bind(&socket).map_err(|e| e.to_string())?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    let mut controller = crate::task_goals::GoalWorker::new(root.into(), crate::codex_binary());
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(|e| e.to_string())?;
                let (reader, mut writer) = stream.into_split();
                let mut line = String::new();
                if !matches!(tokio::time::timeout(Duration::from_secs(5), BufReader::new(reader).read_line(&mut line)).await, Ok(Ok(n)) if n > 0) { continue; }
                let request = serde_json::from_str::<Value>(&line);
                let handoff = request.as_ref().is_ok_and(|value| matches!(value["op"].as_str(), Some("handoff" | "update_handoff")));
                let result = match request {
                    Ok(value) if value["op"] == "handoff" => Ok(json!(true)),
                    Ok(value) if value["op"] == "update_handoff" => board_busy(root).map(|busy| json!(!busy)),
                    Ok(value) => controller.command(value).await,
                    Err(error) => Err(error.to_string()),
                };
                let relinquish = handoff && result.as_ref().is_ok_and(|value| value == true);
                let response = match result { Ok(value) => json!({"result":value}), Err(error) => json!({"error":error}) };
                let reply = writer.write_all(format!("{response}\n").as_bytes()).await;
                if relinquish { return reply.map_err(|error| error.to_string()); }
            }
            _ = interval.tick() => { if let Err(error) = controller.tick().await { eprintln!("Task reconciliation: {error}"); } }
        }
    }
}
#[cfg(not(unix))]
pub async fn worker(_: &Path) -> Result<(), String> { Err("Background tasks require Unix support".into()) }

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn update_waits_for_queued_work_and_takes_ownership_from_an_idle_worker() {
        let root = std::env::temp_dir().join(format!("nooki-updater-worker-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let path = root.join("task-board.json");
        fs::write(&path, r#"{"paused":true,"cards":[{"id":"test","title":"Test","description":"","status":"queued","engine":"goals"}]}"#).unwrap();
        let worker_root = root.clone();
        let worker = tokio::spawn(async move { super::worker(&worker_root).await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !root.join("task-worker.sock").exists() {
                assert!(!worker.is_finished(), "worker failed to start");
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("worker startup timed out");

        assert!(update_guard(&root).await.unwrap().is_none());
        assert!(!worker.is_finished());

        let pending = path.with_extension("pending");
        fs::write(&pending, r#"{"cards":[]}"#).unwrap();
        fs::rename(pending, path).unwrap();
        let guard = update_guard(&root).await.unwrap().expect("idle worker should release ownership");
        worker.await.unwrap().unwrap();
        assert!(file_lock(&root.join("task-worker.lock")).unwrap().is_none());
        drop(guard);
        fs::remove_dir_all(root).unwrap();
    }
}
