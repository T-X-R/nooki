//! Headless adapters used by Claude Code (MCP stdio) and the pi extension.

use crate::capability_bridge::{self, CapabilityRelayEndpoint, TOOL_DESCRIPTION, TOOL_NAME};
use serde_json::{json, Map, Value};
use std::{io::{BufRead, Read, Write}, path::PathBuf};

fn environment(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("Missing {name}"))
}

fn endpoint() -> Result<CapabilityRelayEndpoint, String> {
    Ok(CapabilityRelayEndpoint {
        socket_path: PathBuf::from(environment("NOOKI_CAPABILITY_SOCKET")?),
        token: environment("NOOKI_CAPABILITY_TOKEN")?,
    })
}

fn context() -> Result<Value, String> {
    Ok(json!({
        "threadId": environment("NOOKI_CAPABILITY_THREAD")?,
        "turnId": environment("NOOKI_CAPABILITY_TURN")?,
        "agent": environment("NOOKI_CAPABILITY_AGENT")?,
    }))
}

async fn forward(arguments: Value, invocation_id: String) -> Result<Value, String> {
    let mut request = arguments.as_object().cloned().ok_or("Capability tool arguments must be an object")?;
    request.insert("invocationId".into(), Value::String(invocation_id));
    request.insert("context".into(), context()?);
    capability_bridge::relay_request(&endpoint()?, Value::Object(request)).await
}

pub async fn serve_mcp() -> Result<(), String> {
    let stdin = std::io::stdin();
    let lines = stdin.lock().lines();
    let mut stdout = std::io::stdout().lock();
    for line in lines {
        let line = line.map_err(|error| error.to_string())?;
        if line.len() > 1_000_000 { return Err("MCP request exceeds 1 MB".into()); }
        let request: Value = serde_json::from_str(&line).map_err(|error| error.to_string())?;
        let Some(id) = request.get("id").cloned() else { continue };
        let method = request["method"].as_str().unwrap_or("");
        let response = match method {
            "initialize" => json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":request["params"]["protocolVersion"],"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"nooki","version":env!("CARGO_PKG_VERSION")}}}),
            "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
            "tools/list" => json!({"jsonrpc":"2.0","id":id,"result":{"tools":[{"name":TOOL_NAME,"description":TOOL_DESCRIPTION,"inputSchema":capability_bridge::tool_input_schema()}]}}),
            "tools/call" if request["params"]["name"] == TOOL_NAME => {
                let result = forward(request["params"]["arguments"].clone(), format!("claude-{}", id)).await;
                match result {
                    Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":value.to_string()}],"isError":value["ok"] != true}}),
                    Err(error) => json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":error}],"isError":true}}),
                }
            },
            _ => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
        };
        writeln!(stdout, "{response}").map_err(|error| error.to_string())?;
        stdout.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub async fn call_once() -> Result<(), String> {
    let mut source = String::new();
    std::io::stdin().take(1_000_001).read_to_string(&mut source).map_err(|error| error.to_string())?;
    if source.len() > 1_000_000 { return Err("Capability request exceeds 1 MB".into()); }
    let mut request: Map<String, Value> = serde_json::from_str(&source).map_err(|error| error.to_string())?;
    let invocation_id = request.remove("invocationId").and_then(|value| value.as_str().map(str::to_owned)).ok_or("Missing invocationId")?;
    let response = forward(Value::Object(request), invocation_id).await?;
    println!("{response}");
    Ok(())
}
