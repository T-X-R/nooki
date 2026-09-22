use std::{path::Path, process::Stdio};
use tokio_tungstenite::{client_async, WebSocketStream};
#[cfg(unix)]
type LocalStream = tokio::net::UnixStream;
#[cfg(not(unix))]
type LocalStream = tokio::net::TcpStream;
pub type Connection = WebSocketStream<LocalStream>;

#[cfg(unix)]
async fn connect(socket: &Path) -> Result<Option<Connection>, String> {
  let stream = match LocalStream::connect(socket).await {
    Ok(stream) => stream,
    Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused) => return Ok(None),
    Err(error) => return Err(format!("Could not connect to Codex: {error}")),
  };
  let (connection, _) = tokio::time::timeout(std::time::Duration::from_secs(5), client_async("ws://localhost/", stream)).await
    .map_err(|_| "Codex socket handshake timed out")?.map_err(|e| format!("Codex socket handshake failed: {e}"))?;
  Ok(Some(connection))
}

// The CLI worker outlives UI connections. The private socket carries WebSocket messages.
#[cfg(unix)]
pub async fn ensure_running(binary: &str, root: &Path, workspace: &Path) -> Result<Connection, String> {
  use std::os::unix::process::CommandExt;
  let socket = root.join("codex.sock");
  if let Some(connection) = connect(&socket).await? { return Ok(connection); }
  // Only a refused or missing endpoint reaches here; never replace an inaccessible/live socket.
  if socket.exists() { std::fs::remove_file(&socket).map_err(|e| e.to_string())?; }
  let log = std::fs::File::create(root.join("codex-background.log")).map_err(|e| e.to_string())?;
  let mut command = crate::codex_command(binary).map_err(|e| e.to_string())?;
  command.args(["app-server", "--listen", &format!("unix://{}", socket.display())])
    .current_dir(workspace).process_group(0).stdin(Stdio::null()).stdout(Stdio::null()).stderr(log);
  let mut child = tokio::process::Command::from(command).kill_on_drop(false).spawn().map_err(|e| format!("Could not start background Codex: {e}"))?;
  for _ in 0..200 {
    if let Some(connection) = connect(&socket).await? {
      tokio::spawn(async move { let _ = child.wait().await; });
      return Ok(connection);
    }
    if child.try_wait().map_err(|e| e.to_string())?.is_some() {
      return Err(format!("Codex 后台服务启动失败，请检查 {} / Could not start background Codex; this requires Unix socket support in Codex CLI.", root.join("codex-background.log").display()));
    }
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
  }
  let _ = child.kill().await;
  Err("Codex background service startup timed out".into())
}

#[cfg(not(unix))]
pub async fn ensure_running(_binary: &str, _root: &Path, _workspace: &Path) -> Result<Connection, String> {
  Err("Background Codex conversations require Unix socket support".into())
}
