//! One Conversation surface with an adapter selected per session.
//!
//! The host owns only routing and the durable mapping from a Nooki conversation to the native
//! session an agent owns. Each adapter still speaks that agent's own protocol.

use crate::{
    codex_conversations::{CodexConversations, ConversationAction},
    conversation_documents::DocumentInputs,
    conversation_skills,
    skill_pool::SkillPool,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Digest;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

pub struct ConversationHost {
    root: PathBuf,
    codex: CodexConversations,
    sink: Arc<dyn Fn(Value) + Send + Sync>,
    worker_executable: PathBuf,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct Catalog {
    sessions: BTreeMap<String, NativeSession>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSession {
    pub(crate) id: String,
    pub(crate) agent: String,
    pub(crate) native_id: String,
    pub(crate) session_file: Option<String>,
    #[serde(default)]
    pub(crate) native_started: bool,
    pub(crate) preview: String,
    #[serde(default)]
    pub(crate) created_at: Option<u64>,
    pub(crate) updated_at: u64,
    pub(crate) archived: bool,
    pub(crate) turns: Vec<Value>,
}

impl ConversationHost {
    pub fn new(binary: String, root: PathBuf, sink: Arc<dyn Fn(Value) + Send + Sync>) -> Self {
        Self {
            root: root.clone(),
            codex: CodexConversations::new(binary, root, sink.clone()),
            sink,
            worker_executable: std::env::current_exe().unwrap_or_default(),
        }
    }
    pub fn with_worker_executable(mut self, executable: PathBuf) -> Self {
        self.worker_executable = executable;
        self
    }
    fn catalog_path(&self) -> PathBuf {
        self.root.join("conversation-agents.json")
    }
    fn load(&self) -> Result<Catalog, String> {
        if !self.catalog_path().exists() {
            return Ok(Catalog::default());
        }
        let mut catalog: Catalog = serde_json::from_slice(
            &std::fs::read(self.catalog_path()).map_err(|_| "无法读取会话 agent 映射")?,
        ).map_err(|_| "会话 agent 映射损坏")?;
        for session in catalog.sessions.values_mut() { crate::native_background::merge(&self.root, session)?; }
        Ok(catalog)
    }
    fn save(&self, catalog: &Catalog) -> Result<(), String> {
        std::fs::create_dir_all(&self.root).map_err(|_| "无法创建会话 agent 映射目录")?;
        let temporary = self.catalog_path().with_extension("json.tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec_pretty(catalog).map_err(|_| "无法保存会话 agent 映射")?,
        )
        .map_err(|_| "无法写入会话 agent 映射")?;
        std::fs::rename(temporary, self.catalog_path())
            .map_err(|_| "无法保存会话 agent 映射".to_string())
    }
    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or_default()
    }
    fn id(agent: &str) -> String {
        format!("{agent}-{}-{}", Self::now(), std::process::id())
    }
    fn view(session: &NativeSession) -> Value {
        // Older catalogs encode creation milliseconds in the native session ID.
        let created_at = session.created_at.unwrap_or_else(|| {
            session.id.split('-').nth(1).and_then(|value| value.parse::<u64>().ok()).unwrap_or_default()
        });
        json!({"id": session.id, "agent": session.agent, "preview": session.preview, "createdAt": created_at as f64 / 1000.0, "updatedAt": session.updated_at, "archived": session.archived, "status": {"type": if session.turns.iter().any(|turn| turn["status"] == "inProgress") { "active" } else { "idle" }}, "turns": session.turns})
    }
    pub fn owns(&self, id: &str) -> Result<bool, String> {
        Ok(self.load()?.sessions.contains_key(id))
    }
    pub async fn list(&self, cursor: Option<String>, archived: bool) -> Result<Value, String> {
        let external: Vec<Value> = self
            .load()?
            .sessions
            .values()
            .filter(|session| session.archived == archived)
            .map(Self::view)
            .collect();
        match self.codex.list(cursor, archived).await {
            Ok(mut result) => {
                if let Some(data) = result["data"].as_array_mut() {
                    data.extend(external);
                }
                Ok(result)
            }
            Err(error) if !external.is_empty() => {
                Ok(json!({"data": external, "nextCursor": null, "warning": error}))
            }
            Err(error) => Err(error),
        }
    }
    pub async fn create(&self, agent: &str) -> Result<Value, String> {
        if agent == "codex" {
            return self.codex.create().await;
        }
        if !matches!(agent, "claude" | "pi") {
            return Err("该 agent 没有 Conversation adapter".into());
        }
        let id = Self::id(agent);
        let native_id = if agent == "claude" {
            uuid_for(&id)
        } else {
            id.clone()
        };
        let now = Self::now();
        let session = NativeSession {
            id: id.clone(),
            agent: agent.into(),
            native_id,
            session_file: (agent == "pi").then(|| format!("agent-sessions/{id}.jsonl")),
            native_started: false,
            preview: String::new(),
            created_at: Some(now),
            updated_at: now,
            archived: false,
            turns: Vec::new(),
        };
        let mut catalog = self.load()?;
        catalog.sessions.insert(id, session.clone());
        self.save(&catalog)?;
        Ok(Self::view(&session))
    }
    pub async fn read(&self, id: &str, cursor: Option<String>) -> Result<Value, String> {
        if let Some(session) = self.load()?.sessions.get(id).cloned() {
            return Ok(Self::view(&session));
        }
        self.codex.read(id, cursor).await
    }
    pub async fn answer_question(&self, thread_id: &str, turn_id: &str, item_id: &str, answers: &[String]) -> Result<(), String> {
        if self.owns(thread_id)? { return Err("This agent does not support async questions".into()); }
        self.codex.answer_question(thread_id, turn_id, item_id, answers).await
    }
    pub async fn reconnect(&self, thread_id: &str, request_id: &str, cancelled: CancellationToken) -> Result<Value, String> {
        if let Some(session) = self.load()?.sessions.get(thread_id) {
            if let Some(turn) = session.turns.iter().find(|turn| turn["status"] == "completed" && turn["items"].as_array().is_some_and(|items| items.iter().any(|item| item["clientId"] == request_id))) {
                (self.sink)(json!({"method":"turn/completed","params":{"threadId":thread_id,"turn":turn}}));
                return Ok(json!({"threadId":thread_id,"turnId":turn["id"],"artifacts":turn["artifacts"]}));
            }
            return crate::native_background::observe(&self.root, thread_id, request_id, &self.sink, cancelled).await;
        }
        self.codex.reconnect(thread_id, request_id, cancelled).await
    }
    pub async fn change(&self, id: &str, action: ConversationAction) -> Result<(), String> {
        let action_name = match action {
            ConversationAction::Archive => "archive",
            ConversationAction::Restore => "restore",
            ConversationAction::Delete => "delete",
        };
        let mut catalog = self.load()?;
        if let Some(session) = catalog.sessions.get_mut(id) {
            match action_name {
                "archive" => session.archived = true,
                "restore" => session.archived = false,
                "delete" if session.archived => {
                    catalog.sessions.remove(id);
                }
                "delete" => {
                    return Err(
                        "只有已归档会话可以永久删除 / Only archived conversations can be deleted"
                            .into(),
                    )
                }
                _ => unreachable!(),
            }
            self.save(&catalog)?;
            return Ok(());
        }
        self.codex.change(id, action).await
    }
    pub async fn run(
        &self,
        request: &ConversationRequest,
        pool: &SkillPool,
        cancelled: CancellationToken,
    ) -> Result<Value, String> {
        // Resolved once, before any agent starts, so a skill that is no longer in the pool stops
        // the turn here instead of reaching an agent as a command it cannot answer.
        let skills = conversation_skills::resolve(pool, &request.skills)?;
        if let Some(session) = self.load()?.sessions.get(&request.thread_id).cloned() {
            if session.turns.iter().any(|turn| turn["items"].as_array().is_some_and(|items| items.iter().any(|item| item["clientId"] == request.request_id))) {
                return self.reconnect(&request.thread_id, &request.request_id, cancelled).await;
            }
            crate::native_background::start(&self.root, &session, pool.agents(), request, &skills, &self.worker_executable)?;
            return crate::native_background::observe(&self.root, &request.thread_id, &request.request_id, &self.sink, cancelled).await;
        }
        self.codex
            .run_with_documents(
                &request.thread_id,
                &request.message,
                &request.context,
                &request.request_id,
                &request.documents,
                &skills,
                cancelled,
            )
            .await
    }
}

#[derive(Serialize, Deserialize)]
pub struct ConversationRequest {
    pub thread_id: String,
    pub message: String,
    pub context: String,
    pub request_id: String,
    pub documents: DocumentInputs,
    /// Pool skills the person attached to this message, by directory name.
    pub skills: Vec<String>,
}

fn uuid_for(seed: &str) -> String {
    let digest = sha2::Sha256::digest(seed.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!("{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}", bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15])
}
