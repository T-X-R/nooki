//! A headless Nooki process owns Claude/pi pipes until the original request finishes.
//! UI clients observe durable snapshots. Reconnecting never launches a CLI or sends a prompt.

use crate::{agent_tools::AgentTools, conversation_host::{ConversationRequest, NativeSession}, conversation_skills::SkillReference, native_agent_sessions::CapabilityLaunch};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs::{self, File, OpenOptions}, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, SystemTime}};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
struct Job {
    root: PathBuf,
    session: NativeSession,
    tools: AgentTools,
    request: ConversationRequest,
    skills: Vec<SkillReference>,
    #[serde(default)]
    capabilities: Option<CapabilityLaunch>,
}

fn directory(root: &Path, thread: &str, request: &str) -> Result<PathBuf, String> {
    for id in [thread, request] {
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return Err("Invalid conversation identity".into());
        }
    }
    Ok(root.join("native-runs").join(thread).join(request))
}

fn write(path: &Path, value: &Value) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

// The OS releases the lock even after a crash. A saved PID alone can be reused by another process.
#[cfg(unix)]
fn lock(path: &Path, wait: bool) -> Result<Option<File>, String> {
    use std::os::fd::AsRawFd;
    let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path).map_err(|e| e.to_string())?;
    let flags = libc::LOCK_EX | if wait { 0 } else { libc::LOCK_NB };
    // SAFETY: flock only uses this owned, open file descriptor for the duration of this call.
    if unsafe { libc::flock(file.as_raw_fd(), flags) } == 0 { return Ok(Some(file)); }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock { Ok(None) } else { Err(error.to_string()) }
}

#[cfg(not(unix))]
fn lock(_path: &Path, _wait: bool) -> Result<Option<File>, String> {
    Err("Background native conversations currently require Unix process support".into())
}

fn snapshot(dir: &Path) -> Result<Value, String> {
    let mut state: Value = serde_json::from_slice(&fs::read(dir.join("state.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if state["turn"]["status"] == "inProgress" && lock(&dir.join("worker.lock"), false)?.is_some() {
        let starting = !dir.join("ready").exists() && fs::metadata(dir.join("job.json")).and_then(|m| m.modified()).ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|elapsed| elapsed < Duration::from_secs(10));
        if !starting {
            state["turn"]["status"] = json!("interrupted");
            state["error"] = json!("后台执行已中断，未重新发送消息 / Background execution ended; no message was resent.");
        }
    }
    Ok(state)
}

pub(crate) fn merge(root: &Path, session: &mut NativeSession) -> Result<(), String> {
    let dir = root.join("native-runs").join(&session.id);
    if !dir.exists() { return Ok(()); }
    let mut states = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.join("state.json").exists() { states.push(snapshot(&path)?); }
    }
    states.sort_by_key(|state| state["createdAt"].as_u64().unwrap_or_default());
    for state in states {
        let turn = state["turn"].clone();
        session.native_started |= turn["status"] == "completed" || state["nativeStarted"] == true;
        session.updated_at = session.updated_at.max(state["createdAt"].as_u64().unwrap_or_default());
        if let Some(message) = turn["items"][0]["content"][0]["text"].as_str() { session.preview = message.chars().take(120).collect(); }
        if let Some(old) = session.turns.iter_mut().find(|old| old["id"] == turn["id"]) { *old = turn; } else { session.turns.push(turn); }
    }
    Ok(())
}

pub(crate) fn start(root: &Path, session: &NativeSession, tools: &AgentTools, request: &ConversationRequest, skills: &[SkillReference], executable: &Path, endpoint: Option<&crate::capability_bridge::CapabilityRelayEndpoint>) -> Result<(), String> {
    let dir = directory(root, &request.thread_id, &request.request_id)?;
    if dir.exists() { return Ok(()); } // An uncertain previous launch must never resubmit this intent.
    fs::create_dir_all(dir.parent().unwrap()).map_err(|e| e.to_string())?;
    let _guard = lock(&dir.parent().unwrap().join("session.lock"), false)?.ok_or("This conversation is already running")?;
    let mut current = session.clone();
    merge(root, &mut current)?;
    if current.turns.iter().any(|turn| turn["status"] == "inProgress") { return Err("This conversation is already running".into()); }
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let created = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    write(&dir.join("state.json"), &json!({"createdAt":created,"turn":{"id":request.request_id,"status":"inProgress","items":[{"id":format!("user-{}",request.request_id),"type":"userMessage","clientId":request.request_id,"content":[{"type":"text","text":request.message}]}]}}))?;
    let capabilities = endpoint.map(|endpoint| CapabilityLaunch { endpoint: endpoint.clone(), helper: executable.to_path_buf() });
    write(&dir.join("job.json"), &json!({"root":root,"session":current,"tools":tools,"request":request,"skills":skills,"capabilities":capabilities}))?;
    let mut command = std::process::Command::new(executable);
    command.arg("--conversation-worker").arg(&dir).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
        .stderr(File::create(dir.join("worker.log")).map_err(|e| e.to_string())?);
    #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
    let mut child = command.spawn().map_err(|e| format!("Could not start background conversation: {e}"))?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

pub(crate) async fn observe(root: &Path, thread: &str, request: &str, sink: &Arc<dyn Fn(Value) + Send + Sync>, cancelled: CancellationToken) -> Result<Value, String> {
    let dir = directory(root, thread, request)?;
    if !dir.exists() { return Err("没有可重连的后台执行，未重新发送消息 / No retained execution; no message was resent.".into()); }
    let mut previous = Value::Null;
    loop {
        let state = snapshot(&dir)?;
        if state != previous {
            (sink)(json!({"method":if state["turn"]["status"] == "inProgress" {"turn/started"} else {"turn/completed"},"params":{"threadId":thread,"turn":state["turn"]}}));
            previous = state.clone();
        }
        if state["turn"]["status"] != "inProgress" {
            if let Some(error) = state["error"].as_str() { return Err(error.into()); }
            return Ok(state["result"].clone());
        }
        // Dropping this observer does nothing. Only an explicit stop creates the cancellation file.
        if cancelled.is_cancelled() { fs::write(dir.join("cancel"), b"").map_err(|e| e.to_string())?; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub async fn worker(dir: &Path) -> Result<(), String> {
    let job: Job = serde_json::from_slice(&fs::read(dir.join("job.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if directory(&job.root, &job.request.thread_id, &job.request.request_id)? != dir { return Err("Worker identity mismatch".into()); }
    let _worker = lock(&dir.join("worker.lock"), false)?.ok_or("Worker already running")?;
    // Do not run a completed/interrupted intent even if someone starts this worker again.
    if dir.join("ready").exists() { return Err("Worker intent already consumed".into()); }
    let _session = lock(&dir.parent().unwrap().join("session.lock"), true)?;
    let mut redacted_job = serde_json::to_value(&job).map_err(|e| e.to_string())?;
    redacted_job["capabilities"] = Value::Null;
    write(&dir.join("job.json"), &redacted_job)?;
    fs::write(dir.join("ready"), std::process::id().to_string()).map_err(|e| e.to_string())?;
    let state: Value = serde_json::from_slice(&fs::read(dir.join("state.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let state = Arc::new(Mutex::new(state));
    let cancelled = CancellationToken::new();
    let cancel_path = dir.join("cancel");
    let cancel_token = cancelled.clone();
    let watcher = tokio::spawn(async move { loop {
        if cancel_path.exists() { cancel_token.cancel(); break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }});
    let sink_state = state.clone();
    let state_path = dir.join("state.json");
    let sink_cancel = cancelled.clone();
    let sink: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(move |event| {
        let mut state = sink_state.lock().unwrap();
        let params = &event["params"];
        if params["turn"].is_object() {
            let mut items = state["turn"]["items"].as_array().cloned().unwrap_or_default();
            for item in params["turn"]["items"].as_array().into_iter().flatten() {
                if let Some(old) = items.iter_mut().find(|old| old["id"] == item["id"]) { *old = item.clone(); } else { items.push(item.clone()); }
            }
            state["turn"] = params["turn"].clone();
            state["turn"]["items"] = json!(items);
        }
        if params["item"].is_object() {
            let items = state["turn"]["items"].as_array_mut().unwrap();
            if let Some(old) = items.iter_mut().find(|old| old["id"] == params["item"]["id"]) {
                old.as_object_mut().unwrap().extend(params["item"].as_object().unwrap().clone());
            } else { items.push(params["item"].clone()); }
        }
        if event["method"] == "session/started" { state["nativeStarted"] = json!(true); }
        if event["method"] == "item/agentMessage/delta" {
            let items = state["turn"]["items"].as_array_mut().unwrap();
            if !items.iter().any(|item| item["id"] == params["itemId"]) { items.push(json!({"id":params["itemId"],"type":"agentMessage","phase":"commentary","text":""})); }
            let item = items.iter_mut().find(|item| item["id"] == params["itemId"]).unwrap();
            item["text"] = json!(format!("{}{}",item["text"].as_str().unwrap_or_default(),params["delta"].as_str().unwrap_or_default()));
        }
        // Completion is committed together with its result/artifacts below.
        state["turn"]["status"] = json!("inProgress");
        if write(&state_path, &state).is_err() { sink_cancel.cancel(); }
    });
    if dir.join("cancel").exists() { cancelled.cancel(); }
    let result = if cancelled.is_cancelled() { Err("Task cancelled".into()) } else {
        crate::native_agent_sessions::run(&job.root, &sink, &job.session, &job.tools, &job.request, &job.skills, job.capabilities.as_ref(), cancelled.clone()).await
    };
    watcher.abort();
    let mut state = state.lock().unwrap();
    match result {
        Ok(turn) => { state["turn"]["status"] = json!("completed"); state["turn"]["artifacts"] = turn.turn["artifacts"].clone(); state["result"] = turn.result; }
        Err(error) => { state["turn"]["status"] = json!(if cancelled.is_cancelled() {"interrupted"} else {"failed"}); state["error"] = json!(error); }
    }
    write(&dir.join("state.json"), &state)
}
