use crate::capability_bridge::CapabilityBridge;
use crate::conversation_documents::{self, DocumentInputs};
use crate::conversation_instructions::CONVERSATION_INSTRUCTIONS;
use crate::conversation_skills::SkillReference;
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use tokio_tungstenite::tungstenite::Message;
use tokio::sync::{broadcast, oneshot, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationAction { Archive, Restore, Delete }

// Codex owns session persistence. This adapter owns only transport and execution receipts.
pub struct CodexConversations {
  binary: String,
  root: PathBuf,
  client: AsyncMutex<Option<Arc<Client>>>,
  sink: Arc<dyn Fn(Value) + Send + Sync>,
  capability_bridge: Option<Arc<CapabilityBridge>>,
  capability_threads: Mutex<HashSet<String>>,
}
struct Client {
  connection: AsyncMutex<SplitSink<crate::codex_background::Connection, Message>>,
  reader: Mutex<Option<tokio::task::AbortHandle>>,
  pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
  next: AtomicU64,
  alive: AtomicBool,
  events: broadcast::Sender<Value>,
  fresh: Mutex<HashSet<String>>,
  answers: AsyncMutex<HashSet<(String, String)>>,
}
impl Drop for Client {
  fn drop(&mut self) {
    if let Ok(reader) = self.reader.get_mut() { if let Some(reader) = reader.take() { reader.abort(); } }
  }
}

fn capability_dynamic_tool() -> Value {
  json!({
    "type":"function",
    "name":crate::capability_bridge::TOOL_NAME,
    "description":crate::capability_bridge::TOOL_DESCRIPTION,
    "inputSchema":crate::capability_bridge::tool_input_schema()
  })
}
impl Client {
  async fn send(&self, value: Value) -> Result<(), String> {
    let result = self.connection.lock().await.send(Message::Text(value.to_string().into())).await;
    if result.is_err() { self.alive.store(false, Ordering::Relaxed); }
    result.map_err(|_| "Codex connection closed".into())
  }
  async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
    let id = self.next.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    self.pending.lock().map_err(|_| "Codex requests unavailable")?.insert(id, sender);
    let sent = self.send(json!({"id":id,"method":method,"params":params})).await;
    let result = match sent {
      Ok(()) => match tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Codex connection closed".into()),
        Err(_) => Err("Codex request timed out".into()),
      },
      Err(error) => Err(error),
    };
    self.pending.lock().map_err(|_| "Codex requests unavailable")?.remove(&id);
    result
  }
}

impl CodexConversations {
  pub fn new(binary: String, root: PathBuf, sink: Arc<dyn Fn(Value) + Send + Sync>) -> Self {
    let capability_threads = std::fs::read(root.join("capability-tool-threads.json")).ok()
      .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    Self { binary, root, client: AsyncMutex::new(None), sink, capability_bridge: None, capability_threads: Mutex::new(capability_threads) }
  }
  pub fn with_capability_bridge(mut self, bridge: Arc<CapabilityBridge>) -> Self { self.capability_bridge = Some(bridge); self }
  fn capability_tools_enabled(&self, thread_id: &str) -> bool {
    self.capability_threads.lock().is_ok_and(|threads| threads.contains(thread_id))
  }
  fn remember_capability_tools(&self, thread_id: &str) -> Result<(), String> {
    let mut threads = self.capability_threads.lock().map_err(|_| "Capability session registry unavailable")?;
    threads.insert(thread_id.into());
    let temporary = self.root.join("capability-tool-threads.json.tmp");
    std::fs::write(&temporary, serde_json::to_vec(&*threads).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, self.root.join("capability-tool-threads.json")).map_err(|error| error.to_string())
  }
  fn developer_instructions(&self, thread_id: &str) -> String {
    if self.capability_bridge.is_some() && !self.capability_tools_enabled(thread_id) {
      format!("{CONVERSATION_INSTRUCTIONS}\nThis conversation predates Nooki capability tools. If the user asks to use an installed Nooki capability, explain that they need to start a new conversation.")
    } else { CONVERSATION_INSTRUCTIONS.into() }
  }
  fn workspace(&self) -> PathBuf { let path = self.root.join("conversation-workspace"); path.canonicalize().unwrap_or(path) }
  async fn connect(&self) -> Result<Arc<Client>, String> {
    let mut current = self.client.lock().await;
    if let Some(client) = current.as_ref().filter(|c| c.alive.load(Ordering::Relaxed)) { return Ok(client.clone()); }
    std::fs::create_dir_all(self.workspace()).map_err(|_| "Could not create conversation workspace")?;
    let connection = crate::codex_background::ensure_running(&self.binary, &self.root, &self.workspace()).await?;
    let (writer, mut reader) = connection.split();
    let (events, _) = broadcast::channel(2048);
    let client = Arc::new(Client { connection: AsyncMutex::new(writer), reader: Mutex::new(None), pending: Mutex::new(HashMap::new()), next: AtomicU64::new(1), alive: AtomicBool::new(true), events, fresh: Mutex::new(HashSet::new()), answers: AsyncMutex::new(HashSet::new()) });
    let weak = Arc::downgrade(&client);
    let sink = self.sink.clone();
    let capability_bridge = self.capability_bridge.clone();
    let reading = tokio::spawn(async move {
      while let Some(Ok(message)) = reader.next().await {
        if message.is_close() { break; }
        let Message::Text(line) = message else { continue };
        let Some(client) = weak.upgrade() else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
        if message.get("method").is_some() && message.get("id").is_some() {
          // Workspace writes need no escalation. Interactive actions outside that scope stay declined.
          let method = message["method"].as_str().unwrap_or("");
          if method == "item/tool/call" && message["params"]["tool"] == crate::capability_bridge::TOOL_NAME {
            let client = client.clone();
            let bridge = capability_bridge.clone();
            tokio::spawn(async move {
              let mut request = message["params"]["arguments"].as_object().cloned().unwrap_or_default();
              request.insert("invocationId".into(), message["params"]["callId"].clone());
              request.insert("context".into(), json!({"threadId":message["params"]["threadId"],"turnId":message["params"]["turnId"],"agent":"codex"}));
              let result = if let Some(bridge) = bridge { bridge.request(Value::Object(request)).await }
                else { Err("Nooki capability broker is unavailable".into()) };
              let (success, content) = match result {
                Ok(response) => (response["ok"] == true, response),
                Err(error) => (false, json!({"ok":false,"error":{"code":"RELAY_FAILED","message":error}})),
              };
              let _ = client.send(json!({"id":message["id"],"result":{"success":success,"contentItems":[{"type":"inputText","text":content.to_string()}]}})).await;
            });
            continue;
          }
          let response = if method.ends_with("requestApproval") { json!({"id":message["id"],"result":{"decision":"decline"}}) }
            else { json!({"id":message["id"],"error":{"code":-32601,"message":"This Nooki conversation supports document edits in its workspace. Ask the user in your reply for other interactive actions."}}) };
          let _ = client.send(response).await;
          sink(json!({"method":"workbench/action-declined","params":{"threadId":message["params"]["threadId"],"message":"The requested interactive action is not supported in this conversation."}}));
        } else if let Some(id) = message["id"].as_u64() {
          if let Ok(mut pending) = client.pending.lock() {
            if let Some(sender) = pending.remove(&id) {
              let result = if message.get("error").is_some() { Err(message["error"]["message"].as_str().unwrap_or("Codex request failed").to_string()) } else { Ok(message["result"].clone()) };
              let _ = sender.send(result);
            }
          }
        } else {
          let method = message["method"].as_str().unwrap_or("");
          // Do not expose raw model internals. The public reasoning summary is the process UI.
          if !method.starts_with("codex/event/") && method != "item/reasoning/textDelta" {
            sink(public_event(message.clone()));
          }
          let _ = client.events.send(message);
        }
      }
      if let Some(client) = weak.upgrade() {
        client.alive.store(false, Ordering::Relaxed);
        if let Ok(mut pending) = client.pending.lock() { for (_, sender) in pending.drain() { let _ = sender.send(Err("Codex connection closed".into())); } }
        let _ = client.events.send(json!({"method":"workbench/disconnected"}));
      }
    });
    *client.reader.lock().map_err(|_| "Codex reader unavailable")? = Some(reading.abort_handle());
    client.request("initialize", json!({"clientInfo":{"name":"personal_workbench","title":"Nooki","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}})).await?;
    client.send(json!({"method":"initialized","params":{}})).await?;
    *current = Some(client.clone());
    Ok(client)
  }
  async fn owned_thread(&self, client: &Client, id: &str) -> Result<Value, String> {
    let result = client.request("thread/read", json!({"threadId":id,"includeTurns":false})).await?;
    let document_workspace = conversation_documents::workspace(&self.root, id);
    let expected = document_workspace.canonicalize().unwrap_or(document_workspace);
    if result["thread"]["cwd"].as_str() != self.workspace().to_str() && result["thread"]["cwd"].as_str() != expected.to_str() { return Err("This session does not belong to Nooki conversations".into()); }
    Ok(result["thread"].clone())
  }
  pub async fn list(&self, cursor: Option<String>, archived: bool) -> Result<Value, String> {
    let mut paths = conversation_documents::workspaces(&self.root)?;
    paths.push(self.workspace());
    self.connect().await?.request("thread/list", json!({"cwd":paths,"cursor":cursor,"archived":archived,"limit":40,"sortKey":"created_at","sortDirection":"desc","sourceKinds":[],"modelProviders":[]})).await
  }
  pub async fn change(&self, id: &str, action: ConversationAction) -> Result<(), String> {
    let client = self.connect().await?;
    let thread = self.owned_thread(&client, id).await?;
    if thread["status"]["type"] == "active" { return Err("请等待会话完成后再操作 / Wait for this conversation to finish".into()); }
    if matches!(action, ConversationAction::Delete) {
      let mut cursor = None;
      loop {
        let page = self.list(cursor, true).await?;
        if page["data"].as_array().ok_or("Codex returned invalid history")?.iter().any(|thread| thread["id"] == id) { break; }
        cursor = page["nextCursor"].as_str().map(String::from);
        if cursor.is_none() { return Err("只有已归档会话可以永久删除 / Only archived conversations can be deleted".into()); }
      }
    }
    let method = match action { ConversationAction::Archive => "thread/archive", ConversationAction::Restore => "thread/unarchive", ConversationAction::Delete => "thread/delete" };
    client.request(method, json!({"threadId":id})).await?;
    client.fresh.lock().map_err(|_| "Codex session state unavailable")?.remove(id);
    Ok(())
  }
  pub async fn create(&self) -> Result<Value, String> {
    let client = self.connect().await?;
    let mut params = json!({"cwd":self.workspace(),"ephemeral":false,"approvalPolicy":"never","sandbox":"read-only","developerInstructions":CONVERSATION_INSTRUCTIONS});
    if self.capability_bridge.is_some() { params["dynamicTools"] = json!([capability_dynamic_tool()]); }
    let result = client.request("thread/start", params).await?;
    let thread = result["thread"].clone();
    let thread_id = thread["id"].as_str().ok_or("Codex did not return a session ID")?;
    client.fresh.lock().map_err(|_| "Codex session state unavailable")?.insert(thread_id.into());
    if self.capability_bridge.is_some() {
      if let Err(error) = self.remember_capability_tools(thread_id) {
        log::warn!("Could not persist Codex capability-tool session {thread_id}: {error}");
      }
    }
    Ok(thread)
  }
  pub async fn read(&self, id: &str, cursor: Option<String>) -> Result<Value, String> {
    let client = self.connect().await?;
    let mut thread = self.owned_thread(&client, id).await?;
    if self.capability_bridge.is_some() { thread["capabilityTools"] = json!(if self.capability_tools_enabled(id) { "available" } else { "new-conversation-required" }); }
    if client.fresh.lock().map_err(|_| "Codex session state unavailable")?.contains(id) { thread["nextCursor"] = Value::Null; return Ok(thread); }
    client.request("thread/resume", json!({"threadId":id,"excludeTurns":true})).await?;
    let page = client.request("thread/turns/list", json!({"threadId":id,"cursor":cursor,"limit":30,"sortDirection":"desc","itemsView":"full"})).await?;
    let mut turns = page["data"].as_array().cloned().unwrap_or_default();
    turns.reverse();
    for turn in &mut turns { sanitize_turn(turn); }
    thread["turns"] = json!(turns);
    thread["nextCursor"] = page["nextCursor"].clone();
    Ok(thread)
  }
  pub async fn answer_question(&self, thread_id: &str, turn_id: &str, item_id: &str, answers: &[String]) -> Result<(), String> {
    let client = self.connect().await?;
    self.owned_thread(&client, thread_id).await?;
    let mut sent = client.answers.lock().await;
    let key = (thread_id.to_string(), item_id.to_string());
    let reply_id = format!("async-answer-{item_id}");
    // Accepted steering may be queued before a userMessage appears in native history.
    if sent.contains(&key) || self.find_turn(&client, thread_id, None, &reply_id).await?.is_some() { return Ok(()); }
    let turn = self.find_turn(&client, thread_id, Some(turn_id), "").await?.ok_or("Question turn not found")?;
    let question = turn["items"].as_array().and_then(|items| items.iter().find(|item| item["id"] == item_id && item["type"] == "agentMessage" && item["delivery"] == "async"))
      .and_then(|item| item["questions"].as_array()).filter(|questions| !questions.is_empty()).ok_or("Async question not found")?;
    if turn["status"] != "inProgress" { return Err("本轮已结束，请在输入框继续发送回答 / This turn has ended. Send your answer in the composer.".into()); }
    if answers.len() != question.len() || answers.iter().any(|answer| answer.trim().is_empty()) { return Err("请回答每个问题 / Answer each question".into()); }
    let message = question.iter().zip(answers).map(|(question, answer)| format!("{}\n{}", question["title"].as_str().unwrap_or(""), answer.trim())).collect::<Vec<_>>().join("\n\n");
    if message.len() > 100_000 { return Err("回答过长 / Answers exceed 100 KB".into()); }
    client.request("turn/steer", json!({"threadId":thread_id,"expectedTurnId":turn_id,"clientUserMessageId":reply_id,"input":[{"type":"text","text":message}]})).await?;
    sent.insert(key);
    Ok(())
  }
  async fn find_turn(&self, client: &Client, thread_id: &str, turn_id: Option<&str>, request_id: &str) -> Result<Option<Value>, String> {
    let mut cursor = Value::Null;
    loop {
      let page = client.request("thread/turns/list", json!({"threadId":thread_id,"cursor":cursor,"limit":50,"sortDirection":"desc","itemsView":"full"})).await?;
      for turn in page["data"].as_array().ok_or("Codex returned invalid history")? {
        if turn_id == turn["id"].as_str() || turn["items"].as_array().is_some_and(|items| items.iter().any(|item| item["type"] == "userMessage" && item["clientId"] == request_id)) { return Ok(Some(turn.clone())); }
      }
      cursor = page["nextCursor"].clone();
      if cursor.is_null() { return Ok(None); }
    }
  }
  pub async fn run(&self, thread_id: &str, message: &str, context: &str, request_id: &str, cancelled: CancellationToken) -> Result<Value, String> {
    self.run_with_documents(thread_id, message, context, request_id, &DocumentInputs::default(), &[], cancelled).await
  }
  pub async fn reconnect(&self, thread_id: &str, request_id: &str, cancelled: CancellationToken) -> Result<Value, String> {
    if request_id.is_empty() || !request_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') { return Err("Invalid conversation request ID".into()); }
    let client = self.connect().await?;
    self.owned_thread(&client, thread_id).await?;
    let receipt = self.root.join("codex-turn-receipts").join(format!("{request_id}.json"));
    let previous = read_receipt(&receipt, thread_id)?;
    client.request("thread/resume", json!({"threadId":thread_id,"excludeTurns":true})).await?;
    let turn = self.find_turn(&client, thread_id, previous.as_ref().and_then(|p| p["turnId"].as_str()), request_id).await?
      .ok_or("未找到原执行记录，未重新发送消息。请刷新会话后确认 / Original execution not found. No message was resent. Refresh the conversation to check.")?;
    self.watch_turn(client, thread_id, request_id, turn["id"].as_str().ok_or("Missing turn ID")?, cancelled).await
  }
  pub async fn run_with_documents(&self, thread_id: &str, message: &str, context: &str, request_id: &str, inputs: &DocumentInputs, skills: &[SkillReference], cancelled: CancellationToken) -> Result<Value, String> {
    if message.trim().is_empty() || message.len() + context.len() > 100_000 { return Err("Message and references must contain between 1 and 100000 UTF-8 bytes".into()); }
    if request_id.is_empty() || !request_id.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'-') { return Err("Invalid conversation request ID".into()); }
    let client = self.connect().await?;
    let session = self.owned_thread(&client, thread_id).await?;
    let fresh = client.fresh.lock().map_err(|_| "Codex session state unavailable")?.contains(thread_id);
    let receipt = self.root.join("codex-turn-receipts").join(format!("{request_id}.json"));
    let previous = read_receipt(&receipt, thread_id)?;
    let existing = if fresh { None } else { self.find_turn(&client, thread_id, previous.as_ref().and_then(|p|p["turnId"].as_str()), request_id).await? };
    if previous.is_some() && existing.is_none() { return Err("Could not reconcile the saved Codex turn. Refresh this session before sending another message.".into()); }
    // A retry is a new observer of the same intent, never another copy of its prompt.
    if let Some(turn) = existing { return self.watch_turn(client, thread_id, request_id, turn["id"].as_str().ok_or("Missing turn ID")?, cancelled).await; }
    if session["status"]["type"] == "active" { return Err("This Codex session is already running. Wait for it to finish before sending another message.".into()); }
    if cancelled.is_cancelled() { return Err("Task cancelled".into()); }
    let document_context = conversation_documents::prepare(&self.root, thread_id, request_id, inputs)?;
    let document_workspace = conversation_documents::workspace(&self.root, thread_id).canonicalize().map_err(|e| e.to_string())?;
    if !fresh { client.request("thread/resume", json!({"threadId":thread_id,"excludeTurns":true,"cwd":document_workspace,"approvalPolicy":"never","sandbox":"workspace-write","developerInstructions":self.developer_instructions(thread_id),"config":{"sandbox_workspace_write.writable_roots":[],"sandbox_workspace_write.network_access":false,"sandbox_workspace_write.exclude_tmpdir_env_var":true,"sandbox_workspace_write.exclude_slash_tmp":true}})).await?; }
    let turn = {
      if cancelled.is_cancelled() { return Err("Task cancelled".into()); }
      // An uncertain start must reconcile history before it can be retried.
      client.fresh.lock().map_err(|_| "Codex session state unavailable")?.remove(thread_id);
      // A skill the person picked travels as Codex's own skill input element -- the same thing its
      // composer sends for `$skill`. Codex loads it; Nooki neither reads nor repeats it.
      let mut input: Vec<Value> = skills.iter().map(|skill| json!({"type":"skill","name":skill.invocation,"path":skill.path})).collect();
      input.push(json!({"type":"text","text":message}));
      let result = client.request("turn/start", json!({"threadId":thread_id,"clientUserMessageId":request_id,"cwd":document_workspace,"approvalPolicy":"never","sandboxPolicy":{"type":"workspaceWrite","writableRoots":[document_workspace],"networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true},"input":input,"additionalContext":{"workbench-library":{"kind":"untrusted","value":context},"workbench-documents":{"kind":"untrusted","value":document_context}},"summary":"auto"})).await?;
      let turn = result["turn"].clone();
      if let Err(error) = write_receipt(&receipt, &json!({"threadId":thread_id,"turnId":turn["id"]})) {
        let _ = client.request("turn/interrupt",json!({"threadId":thread_id,"turnId":turn["id"]})).await;
        return Err(error);
      }
      turn
    };
    self.watch_turn(client, thread_id, request_id, turn["id"].as_str().ok_or("Codex did not return a turn ID")?, cancelled).await
  }
  async fn watch_turn(&self, client: Arc<Client>, thread_id: &str, request_id: &str, turn_id: &str, cancelled: CancellationToken) -> Result<Value, String> {
    let mut events = client.events.subscribe();
    client.request("thread/resume", json!({"threadId":thread_id,"excludeTurns":true})).await?;
    let mut turn = self.find_turn(&client, thread_id, Some(turn_id), request_id).await?.ok_or("Original turn not found")?;
    (self.sink)(public_event(json!({"method":if turn["status"] == "inProgress" { "turn/started" } else { "turn/completed" },"params":{"threadId":thread_id,"turn":turn.clone()}})));
    loop {
      match turn["status"].as_str() {
        Some("completed") => {
          if cancelled.is_cancelled() { return Err("Task cancelled".into()); }
          if !conversation_documents::has_output(&self.root, thread_id, request_id) {
            let latest = client.request("thread/turns/list", json!({"threadId":thread_id,"limit":1,"sortDirection":"desc","itemsView":"full"})).await?;
            if latest["data"][0]["id"] != turn_id { return Err("This turn's document result was not retained before newer work. Open the latest document result instead.".into()); }
          }
          let artifacts = conversation_documents::complete(&self.root, thread_id, request_id)?;
          return Ok(json!({"threadId":thread_id,"turnId":turn_id,"artifacts":artifacts}));
        },
        Some("failed") => return Err(turn["error"]["message"].as_str().unwrap_or("Codex turn failed").into()),
        Some("interrupted") => return Err("Codex 执行已中断；未重新发送原消息。可在输入框发送消息继续 / Codex turn interrupted. No message was resent. Send a message to continue.".into()),
        _ => {}
      }
      tokio::select! {
        biased;
        _ = cancelled.cancelled() => {
          client.request("turn/interrupt",json!({"threadId":thread_id,"turnId":turn_id})).await?;
          return Err("Task cancelled".into());
        },
        event = events.recv() => {
          match event {
            Ok(event) if event["method"] == "workbench/disconnected" => return Err("与 Codex 的连接已断开，可重新连接核对执行状态 / Codex disconnected. Reconnect to check this turn.".into()),
            Ok(event) if event["method"] == "turn/completed" && event["params"]["threadId"] == thread_id && event["params"]["turn"]["id"] == turn_id => { turn = event["params"]["turn"].clone(); },
            Err(broadcast::error::RecvError::Closed) => return Err("Codex event stream closed".into()),
            Err(broadcast::error::RecvError::Lagged(_)) => { if let Some(current) = self.find_turn(&client, thread_id, Some(turn_id), request_id).await? { turn = current; } },
            _ => {}
          }
        }
      }
    }
  }
}
fn read_receipt(path: &Path, thread_id: &str) -> Result<Option<Value>, String> {
  let receipt = if path.exists() { Some(serde_json::from_slice::<Value>(&std::fs::read(path).map_err(|_| "Could not read turn receipt")?).map_err(|_| "Invalid turn receipt")?) } else { None };
  if receipt.as_ref().is_some_and(|p| p["threadId"] != thread_id) { return Err("Turn receipt belongs to another session".into()); }
  Ok(receipt)
}
fn write_receipt(path: &Path, receipt: &Value) -> Result<(), String> {
  std::fs::create_dir_all(path.parent().ok_or("Invalid receipt path")?).map_err(|_|"Could not create receipt directory")?;
  let temporary = path.with_extension("tmp");
  std::fs::write(&temporary, serde_json::to_vec(receipt).map_err(|_|"Could not encode receipt")?).map_err(|_|"Could not write turn receipt")?;
  std::fs::rename(temporary,path).map_err(|_|"Could not save turn receipt".into())
}
pub fn sanitize_turn(turn: &mut Value) {
  if let Some(items) = turn["items"].as_array_mut() { for item in items { if item["type"] == "reasoning" { item["content"] = json!([]); } } }
}
pub fn public_event(mut event: Value) -> Value {
  if event["params"]["item"]["type"] == "reasoning" { event["params"]["item"]["content"] = json!([]); }
  if event["params"].get("turn").is_some() { sanitize_turn(&mut event["params"]["turn"]); }
  event
}
