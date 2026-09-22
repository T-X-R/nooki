//! Native session transports for Claude Code and pi.

use crate::{
    agent_tools::AgentTools,
    conversation_documents,
    conversation_host::{ConversationRequest, NativeSession},
    conversation_instructions::{CONVERSATION_INSTRUCTIONS, UNTRUSTED_CONTEXT},
    conversation_skills::{self, SkillReference},
};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Child,
};
use tokio_util::sync::CancellationToken;

pub struct NativeTurn {
    pub result: Value,
    pub turn: Value,
}

/// What every transport needs regardless of which agent answers. Only the handle to an agent's own
/// session -- a file for pi, an id for Claude Code -- stays an argument, because that handle is the
/// one thing the agents do not share.
struct TurnContext<'a> {
    tools: &'a AgentTools,
    workspace: &'a Path,
    message: &'a str,
    thread_id: &'a str,
    request_id: &'a str,
    sink: &'a Arc<dyn Fn(Value) + Send + Sync>,
    cancelled: CancellationToken,
}

pub(crate) async fn run(
    root: &Path,
    sink: &Arc<dyn Fn(Value) + Send + Sync>,
    session: &NativeSession,
    tools: &AgentTools,
    request: &ConversationRequest,
    skills: &[SkillReference],
    cancelled: CancellationToken,
) -> Result<NativeTurn, String> {
    if request.message.trim().is_empty()
        || request.message.len() + request.context.len() > 100_000
    {
        return Err("Message and references must contain between 1 and 100000 UTF-8 bytes".into());
    }
    if request.request_id.is_empty()
        || !request
            .request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid conversation request ID".into());
    }
    let document_context = conversation_documents::prepare(
        root,
        &request.thread_id,
        &request.request_id,
        &request.documents,
    )?;
    let workspace = conversation_documents::workspace(root, &request.thread_id)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let user_item = json!({"id": format!("user-{}", request.request_id), "type": "userMessage", "clientId": request.request_id, "content": [{"type": "text", "text": request.message}]});
    let turn_id = request.request_id.clone();
    let started = json!({"id": turn_id, "status": "inProgress", "items": [user_item]});
    (sink)(
        json!({"method":"turn/started", "params":{"threadId":request.thread_id, "turn":started}}),
    );
    // Codex carries this boundary structurally through additionalContext.kind. These transports
    // offer no such channel, so it has to travel inside the message -- once, not once per section.
    // Neither CLI takes a structured skill reference, so the skill command leads the message, the
    // way it would if the person had typed it into that CLI. Everything after it is its argument.
    let message = format!(
        "{}{}\n\n{UNTRUSTED_CONTEXT}\n{}\n\n{}",
        conversation_skills::command_prefix(&session.agent, skills),
        request.message,
        request.context,
        document_context
    );
    let context = TurnContext {
        tools,
        workspace: &workspace,
        message: &message,
        thread_id: &request.thread_id,
        request_id: &request.request_id,
        sink,
        cancelled,
    };
    let (text, model) = match session.agent.as_str() {
        "pi" => {
            let session_file = session
                .session_file
                .as_deref()
                .map(|path| {
                    let path = Path::new(path);
                    if path.is_absolute() {
                        path.to_path_buf()
                    } else {
                        root.join(path)
                    }
                })
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or("pi session file missing")?;
            run_pi(&context, &session_file).await?
        }
        "claude" => run_claude(&context, &session.native_id, !session.native_started).await?,
        _ => return Err("Unsupported native Conversation agent".into()),
    };
    let artifacts =
        conversation_documents::complete(root, &request.thread_id, &request.request_id)?;
    let turn = json!({"id": request.request_id, "status": "completed", "items": [user_item, {"id": format!("assistant-{}", request.request_id), "type": "agentMessage", "text": text, "phase": "final", "model": model}], "artifacts": artifacts});
    (sink)(
        json!({"method":"turn/completed", "params":{"threadId":request.thread_id, "turn":turn}}),
    );
    Ok(NativeTurn {
        result: json!({"threadId":request.thread_id, "turnId":request.request_id, "artifacts":artifacts}),
        turn,
    })
}

async fn run_pi(ctx: &TurnContext<'_>, session_file: &str) -> Result<(String, String), String> {
    if !ctx.tools.binary("pi") {
        return Err("pi 现在无法承接会话请求，请先安装并配置它。".into());
    }
    let parent = Path::new(session_file)
        .parent()
        .ok_or("Invalid pi session path")?;
    std::fs::create_dir_all(parent).map_err(|_| "无法创建 pi 会话目录")?;
    let mut command = ctx.tools.command("pi").map_err(|_| "无法启动 pi")?;
    // Pi documents that it ships no sandbox, so its own flags are the whole boundary. A strict
    // allowlist keeps bash out of a document conversation; --no-approve refuses to treat Nooki's
    // scratch directory as a trusted pi project; --no-context-files stops an AGENTS.md the agent
    // itself just wrote from being read back as instructions on the next turn.
    command.current_dir(ctx.workspace).args([
        "--mode",
        "rpc",
        "--session",
        session_file,
        "--no-approve",
        "--no-context-files",
        "--tools",
        "read,edit,write,ls",
        "--append-system-prompt",
        CONVERSATION_INSTRUCTIONS,
    ]);
    let mut child = command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "无法启动 pi")?;
    let mut stdin = child.stdin.take().ok_or("pi stdin unavailable")?;
    stdin
        .write_all(
            serde_json::to_string(
                &json!({"id":ctx.request_id,"type":"prompt","message":ctx.message}),
            )
            .map_err(|_| "无法编码 pi 请求")?
            .as_bytes(),
        )
        .await
        .map_err(|_| "pi 连接已关闭")?;
    stdin.write_all(b"\n").await.map_err(|_| "pi 连接已关闭")?;
    let stdout = child.stdout.take().ok_or("pi stdout unavailable")?;
    read_pi_events(&mut child, BufReader::new(stdout), ctx).await
}

async fn read_pi_events<R: tokio::io::AsyncRead + Unpin>(
    child: &mut Child,
    lines: BufReader<R>,
    ctx: &TurnContext<'_>,
) -> Result<(String, String), String> {
    let mut lines = lines.lines();
    let mut text = String::new();
    let mut model = String::new();
    let mut settled = false;
    let mut failure = None;
    loop {
        let line = tokio::select! { _ = ctx.cancelled.cancelled() => { let _ = child.kill().await; return Err("Task cancelled".into()); }, line = lines.next_line() => line.map_err(|_| "pi 输出读取失败")? };
        let Some(line) = line else { break };
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if event["type"] == "response" && event["command"] == "prompt" && event["success"] == false {
            return Err(event["error"].as_str().unwrap_or("pi rejected the prompt").into());
        }
        if event["type"] == "agent_start" {
            (ctx.sink)(json!({"method":"session/started","params":{"threadId":ctx.thread_id,"turnId":ctx.request_id}}));
        }
        if matches!(event["type"].as_str(), Some("tool_execution_start" | "tool_execution_end")) {
            let done = event["type"] == "tool_execution_end";
            let mut item = json!({"id":event["toolCallId"],"type":"commandExecution","status":if done {if event["isError"] == true {"failed"} else {"completed"}} else {"inProgress"}});
            if !done { item["command"] = json!(format!("{} {}",event["toolName"].as_str().unwrap_or("tool"),event["args"])); }
            (ctx.sink)(json!({"method":if done {"item/completed"} else {"item/started"},"params":{"threadId":ctx.thread_id,"turnId":ctx.request_id,"item":item}}));
        }
        if let Some(named) = event["message"]["model"]
            .as_str()
            .or_else(|| event["model"].as_str())
        {
            model = named.to_string();
        }
        if event["type"] == "message_update"
            && event["assistantMessageEvent"]["type"] == "text_delta"
        {
            if let Some(delta) = event["assistantMessageEvent"]["delta"].as_str() {
                text.push_str(delta);
                (ctx.sink)(
                    json!({"method":"item/agentMessage/delta","params":{"threadId":ctx.thread_id,"turnId":ctx.request_id,"itemId":format!("assistant-{}", ctx.request_id),"delta":delta}}),
                );
            }
        }
        if event["type"] == "message_end" && event["message"]["role"] == "assistant" {
            failure = matches!(event["message"]["stopReason"].as_str(), Some("error" | "aborted"))
                .then(|| event["message"]["errorMessage"].as_str().unwrap_or("pi did not complete the request").to_string());
            if let Some(final_text) = event["message"]["content"]
                .as_array()
                .and_then(|items| items.iter().find_map(|item| item["text"].as_str()))
            {
                text = final_text.to_string();
            }
        }
        if event["type"] == "agent_settled" {
            settled = true;
            let _ = child.kill().await;
            break;
        }
    }
    if !settled { return Err("pi disconnected before completing the request".into()); }
    if let Some(error) = failure { return Err(error); }
    if text.trim().is_empty() {
        return Err("pi 没有返回文本结果。".into());
    }
    Ok((text, model))
}

/// Only an explicit session lookup failure permits changing launch mode. Unknown failures may
/// follow real work and must never cause an automatic resubmission.
struct ClaudeFailure {
    message: String,
    retryable: bool,
}

impl ClaudeFailure {
    fn fatal(message: &str) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
}

async fn run_claude(
    ctx: &TurnContext<'_>,
    native_id: &str,
    first: bool,
) -> Result<(String, String), String> {
    let failure = match claude_turn(ctx, native_id, first).await {
        Ok(result) => return Ok(result),
        Err(failure) => failure,
    };
    if !failure.retryable || ctx.cancelled.is_cancelled() {
        return Err(failure.message);
    }
    // This is a CLI session lookup rejection before execution, never a connection recovery.
    claude_turn(ctx, native_id, !first)
        .await
        .map_err(|fallback| fallback.message)
}

async fn claude_turn(
    ctx: &TurnContext<'_>,
    native_id: &str,
    first: bool,
) -> Result<(String, String), ClaudeFailure> {
    if !ctx.tools.binary("claude") {
        return Err(ClaudeFailure::fatal(
            "Claude Code 现在无法承接会话请求，请先安装并登录。",
        ));
    }
    let mut command = ctx
        .tools
        .command("claude")
        .map_err(|_| ClaudeFailure::fatal("无法启动 Claude Code"))?;
    // Claude Code refuses to start when --print streams stream-json without --verbose, so every
    // turn died before it began. The flag is a hard requirement of the CLI, not a preference.
    command.current_dir(ctx.workspace).args([
        "--print",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
    ]);
    if first {
        command.args(["--session-id", native_id]);
    } else {
        command.args(["--resume", native_id]);
    }
    command
        .args(["--permission-mode", "acceptEdits"])
        .args(["--append-system-prompt", CONVERSATION_INSTRUCTIONS])
        // Skill is on the list so a skill the person named can be dispatched the way Claude Code
        // dispatches its own; the rest of the list is unchanged.
        .args(["--allowed-tools", "Read", "Edit", "Write", "Skill", "--add-dir"])
        .arg(ctx.workspace);
    let mut child = command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ClaudeFailure::fatal("无法启动 Claude Code"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ClaudeFailure::fatal("Claude stdin unavailable"))?;
    let input = serde_json::to_string(
        &json!({"type":"user","message":{"role":"user","content":ctx.message}}),
    )
    .map_err(|_| ClaudeFailure::fatal("无法编码 Claude 请求"))?;
    stdin
        .write_all(input.as_bytes())
        .await
        .map_err(|_| ClaudeFailure::fatal("Claude 连接已关闭"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|_| ClaudeFailure::fatal("Claude 连接已关闭"))?;
    drop(stdin);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ClaudeFailure::fatal("Claude stdout unavailable"))?;
    read_claude_events(&mut child, BufReader::new(stdout), ctx).await
}

async fn read_claude_events<R: tokio::io::AsyncRead + Unpin>(
    child: &mut Child,
    lines: BufReader<R>,
    ctx: &TurnContext<'_>,
) -> Result<(String, String), ClaudeFailure> {
    let mut lines = lines.lines();
    let mut text = String::new();
    let mut model = String::new();
    let mut started = false;
    let mut completed = false;
    while let Some(line) = tokio::select! { _ = ctx.cancelled.cancelled() => { let _ = child.kill().await; return Err(ClaudeFailure::fatal("Task cancelled")); }, line = lines.next_line() => line.map_err(|_| ClaudeFailure { message: "Claude 输出读取失败".into(), retryable: false })? }
    {
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if event["type"] == "system" && event["subtype"] == "init" {
            started = true;
            (ctx.sink)(json!({"method":"session/started","params":{"threadId":ctx.thread_id,"turnId":ctx.request_id}}));
        }
        if event["type"] == "assistant" {
            for item in event["message"]["content"].as_array().into_iter().flatten().filter(|item| item["type"] == "tool_use") {
                (ctx.sink)(json!({"method":"item/started","params":{"threadId":ctx.thread_id,"turnId":ctx.request_id,"item":{"id":item["id"],"type":"commandExecution","command":format!("{} {}",item["name"].as_str().unwrap_or("tool"),item["input"]),"status":"inProgress"}}}));
            }
        }
        if event["type"] == "user" {
            for item in event["message"]["content"].as_array().into_iter().flatten().filter(|item| item["type"] == "tool_result") {
                (ctx.sink)(json!({"method":"item/completed","params":{"threadId":ctx.thread_id,"turnId":ctx.request_id,"item":{"id":item["tool_use_id"],"type":"commandExecution","status":if item["is_error"] == true {"failed"} else {"completed"}}}}));
            }
        }
        if let Some(named) = event["model"]
            .as_str()
            .or_else(|| event["message"]["model"].as_str())
        {
            model = named.to_string();
        }
        if event["type"] == "stream_event"
            && event["event"]["type"] == "content_block_delta"
            && event["event"]["delta"]["type"] == "text_delta"
        {
            if let Some(delta) = event["event"]["delta"]["text"].as_str() {
                text.push_str(delta);
                started = true;
                (ctx.sink)(
                    json!({"method":"item/agentMessage/delta","params":{"threadId":ctx.thread_id,"turnId":ctx.request_id,"itemId":format!("assistant-{}", ctx.request_id),"delta":delta}}),
                );
            }
        }
        if event["type"] == "result" {
            // Failed result text is an error, not an assistant answer.
            if event["is_error"] == true {
                let _ = child.kill().await;
                return Err(ClaudeFailure {
                    message: event["result"]
                        .as_str()
                        .unwrap_or("Claude Code 未能完成这次会话请求。")
                        .into(),
                    retryable: !started && event["result"].as_str().is_some_and(|message| message.starts_with("No conversation found with session ID") || message.starts_with("Session ID") && message.contains("already in use")),
                });
            }
            if let Some(result) = event["result"].as_str() {
                text = result.to_string();
            }
            completed = true;
        }
    }
    if !completed { return Err(ClaudeFailure::fatal("Claude Code disconnected before completing the request")); }
    if text.trim().is_empty() {
        return Err(ClaudeFailure {
            message: "Claude Code 没有返回文本结果。".into(),
            retryable: false,
        });
    }
    Ok((text, model))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{conversation_documents::DocumentInputs, conversation_host::NativeSession};
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, sync::Mutex};

    fn fixture(
        agent: &str,
        label: &str,
        output: &str,
    ) -> (PathBuf, AgentTools, NativeSession, Arc<Mutex<Vec<Value>>>) {
        let root = std::env::temp_dir().join(format!(
            "nooki-native-{agent}-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".local/bin")).unwrap();
        let binary = root.join(format!(".local/bin/{agent}"));
        fs::write(
            &binary,
            format!(
                "#!/bin/sh\nprintf '%b\\n' '{}'\n",
                output.replace('\'', "'\\''")
            ),
        )
        .unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let tools = AgentTools::new(root.clone());
        let session = NativeSession {
            id: format!("{agent}-thread"),
            agent: agent.into(),
            native_id: "00000000-0000-4000-8000-000000000001".into(),
            session_file: Some(
                root.join("agent-sessions/pi.jsonl")
                    .to_string_lossy()
                    .into_owned(),
            ),
            native_started: false,
            preview: String::new(),
            created_at: None,
            updated_at: 0,
            archived: false,
            turns: Vec::new(),
        };
        let events = Arc::new(Mutex::new(Vec::new()));
        (root, tools, session, events)
    }

    #[tokio::test]
    async fn pi_rpc_events_are_normalized_without_replaying_history() {
        let output = r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}\n{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}],"model":"pi-model"}}\n{"type":"agent_settled"}"#;
        let (root, tools, session, events) = fixture("pi", "stream", output);
        let sink_events = events.clone();
        let sink: Arc<dyn Fn(Value) + Send + Sync> =
            Arc::new(move |event| sink_events.lock().unwrap().push(event));
        let request = ConversationRequest {
            thread_id: session.id.clone(),
            message: "hello".into(),
            context: "ctx".into(),
            request_id: "request-1".into(),
            documents: DocumentInputs::default(),
            skills: Vec::new(),
        };
        let result = run(
            &root,
            &sink,
            &session,
            &tools,
            &request,
            &[],
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result.turn["items"][0]["content"][0]["text"], "hello");
        assert_eq!(result.result["turnId"], "request-1");
        assert_eq!(result.turn["items"][1]["text"], "hello");
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["method"] == "item/agentMessage/delta"));
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn claude_stream_events_are_normalized() {
        let output = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}}\n{"type":"result","result":"hello","model":"claude-model"}"#;
        let (root, tools, session, events) = fixture("claude", "stream", output);
        let sink_events = events.clone();
        let sink: Arc<dyn Fn(Value) + Send + Sync> =
            Arc::new(move |event| sink_events.lock().unwrap().push(event));
        let request = ConversationRequest {
            thread_id: session.id.clone(),
            message: "hello".into(),
            context: String::new(),
            request_id: "request-2".into(),
            documents: DocumentInputs::default(),
            skills: Vec::new(),
        };
        let result = run(
            &root,
            &sink,
            &session,
            &tools,
            &request,
            &[],
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result.turn["items"][1]["text"], "hello");
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["method"] == "item/agentMessage/delta"));
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn each_agent_is_launched_with_the_flags_its_own_cli_demands() {
        for agent in ["pi", "claude"] {
            let (root, tools, mut session, _events) = fixture(agent, "flags", "");
            session.agent = agent.into();
            let recorded = root.join("argv");
            let script = r#"#!/bin/sh
for argument in "$@"; do printf '%s\n' "$argument" >> "RECORDED"; done
printf '%b\n' 'IGNORED'
"#
            .replace("RECORDED", &recorded.to_string_lossy())
            .replace(
                "IGNORED",
                if agent == "pi" {
                    r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n{"type":"agent_settled"}"#
                } else {
                    r#"{"type":"result","result":"done"}"#
                },
            );
            let binary = root.join(format!(".local/bin/{agent}"));
            fs::write(&binary, script).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
            let sink: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(|_| {});
            let request = ConversationRequest {
                thread_id: session.id.clone(),
                message: "hello".into(),
                context: String::new(),
                request_id: "request-flags".into(),
                documents: DocumentInputs::default(),
                skills: Vec::new(),
            };
            run(
                &root,
                &sink,
                &session,
                &tools,
                &request,
                &[],
                CancellationToken::new(),
            )
            .await
            .unwrap();
            let argv = fs::read_to_string(&recorded).unwrap();
            // Nooki's rules reach every agent through that agent's own system-prompt channel.
            assert!(argv.contains(CONVERSATION_INSTRUCTIONS));
            assert!(argv.lines().any(|line| line == "--append-system-prompt"));
            if agent == "claude" {
                // Claude Code rejects streamed stream-json output without it.
                assert!(argv.lines().any(|line| line == "--verbose"));
                // A skill the person named is dispatched by Claude Code's own Skill tool.
                assert!(argv.lines().any(|line| line == "Skill"));
            } else {
                // Pi has no sandbox, so its own flags carry the whole boundary.
                assert!(argv.lines().any(|line| line == "read,edit,write,ls"));
                assert!(argv.lines().any(|line| line == "--no-approve"));
                assert!(argv.lines().any(|line| line == "--no-context-files"));
            }
            let _ = fs::remove_dir_all(root);
        }
    }

    /// Nooki is the bridge, not the interpreter: the skill reaches each CLI as the command that
    /// CLI expands itself, ahead of the person's own words.
    #[tokio::test]
    async fn an_attached_skill_leads_the_prompt_as_that_cli_writes_it() {
        for (agent, expected) in [("pi", "/skill:pdf hello"), ("claude", "/pdf hello")] {
            let (root, tools, mut session, _events) = fixture(agent, "skills", "");
            session.agent = agent.into();
            let recorded = root.join("prompt");
            let script = r#"#!/bin/sh
head -n 1 > "RECORDED"
printf '%b\n' 'IGNORED'
"#
            .replace("RECORDED", &recorded.to_string_lossy())
            .replace(
                "IGNORED",
                if agent == "pi" {
                    r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n{"type":"agent_settled"}"#
                } else {
                    r#"{"type":"result","result":"done"}"#
                },
            );
            let binary = root.join(format!(".local/bin/{agent}"));
            fs::write(&binary, script).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
            let sink: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(|_| {});
            let request = ConversationRequest {
                thread_id: session.id.clone(),
                message: "hello".into(),
                context: String::new(),
                request_id: "request-skill".into(),
                documents: DocumentInputs::default(),
                skills: vec!["pdf-tools".into()],
            };
            let skills = [SkillReference {
                directory: "pdf-tools".into(),
                invocation: "pdf".into(),
                path: root.join(".agents/skills/pdf-tools"),
            }];
            run(
                &root,
                &sink,
                &session,
                &tools,
                &request,
                &skills,
                CancellationToken::new(),
            )
            .await
            .unwrap();
            let sent = fs::read_to_string(&recorded).unwrap();
            let sent: Value = serde_json::from_str(sent.trim()).unwrap();
            let prompt = if agent == "pi" { sent["message"].as_str() } else { sent["message"]["content"].as_str() }.unwrap();
            assert!(prompt.starts_with(expected), "{agent} received {prompt}");
            let _ = fs::remove_dir_all(root);
        }
    }

    #[tokio::test]
    async fn claude_recovers_when_nooki_guesses_the_wrong_session_mode() {
        let (root, tools, session, _events) = fixture("claude", "resume-fallback", "");
        let marker = root.join("first-attempt");
        let script = r#"#!/bin/sh
if [ -f "MARKER" ]; then
  printf '%s\n' '{"type":"result","result":"recovered","model":"claude-model"}'
else
  : > "MARKER"
  printf '%s\n' '{"type":"result","is_error":true,"result":"No conversation found with session ID"}'
fi
"#
        .replace("MARKER", &marker.to_string_lossy());
        let binary = root.join(".local/bin/claude");
        fs::write(&binary, script).unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
        let sink: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(|_| {});
        let request = ConversationRequest {
            thread_id: session.id.clone(),
            message: "hello".into(),
            context: String::new(),
            request_id: "request-3".into(),
            documents: DocumentInputs::default(),
            skills: Vec::new(),
        };
        let result = run(
            &root,
            &sink,
            &session,
            &tools,
            &request,
            &[],
            CancellationToken::new(),
        )
        .await
        .unwrap();
        // The reported failure must not surface as the assistant's answer, and the wrong guess
        // must cost a retry rather than the conversation.
        assert_eq!(result.turn["items"][1]["text"], "recovered");
        assert!(marker.is_file());
        let _ = fs::remove_dir_all(root);
    }
}
