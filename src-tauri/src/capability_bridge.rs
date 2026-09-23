//! Canonical request bridge between agent transports and the renderer capability broker.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{oneshot, Notify};

const MAX_REQUEST_BYTES: u64 = 1_000_000;
const RENDERER_READY_TIMEOUT: Duration = Duration::from_secs(30);
const INVOCATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityRelayEndpoint {
    pub socket_path: PathBuf,
    pub token: String,
}

#[derive(Deserialize, Serialize)]
struct RelayRequest {
    token: String,
    request: Value,
}

pub struct CapabilityBridge {
    endpoint: CapabilityRelayEndpoint,
    sink: Arc<dyn Fn(Value) + Send + Sync>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    next: AtomicU64,
    renderer_ready: AtomicBool,
    ready: Notify,
}

impl CapabilityBridge {
    pub fn new(root: &Path, sink: Arc<dyn Fn(Value) + Send + Sync>) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
        Ok(Self {
            endpoint: CapabilityRelayEndpoint {
                socket_path: root.join("capability-broker.sock"),
                token: relay_token(),
            },
            sink,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            renderer_ready: AtomicBool::new(false),
            ready: Notify::new(),
        })
    }

    pub fn endpoint(&self) -> CapabilityRelayEndpoint {
        self.endpoint.clone()
    }

    pub fn renderer_ready(&self) {
        self.renderer_ready.store(true, Ordering::Release);
        self.ready.notify_waiters();
    }

    async fn wait_for_renderer(&self) -> Result<(), String> {
        if self.renderer_ready.load(Ordering::Acquire) {
            return Ok(());
        }
        let notified = self.ready.notified();
        if self.renderer_ready.load(Ordering::Acquire) {
            return Ok(());
        }
        tokio::time::timeout(RENDERER_READY_TIMEOUT, notified)
            .await
            .map_err(|_| "Nooki capability broker is not ready".to_string())?;
        Ok(())
    }

    pub async fn request(&self, request: Value) -> Result<Value, String> {
        self.wait_for_renderer().await?;
        let id = format!(
            "capability-{}-{}",
            std::process::id(),
            self.next.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "Capability broker requests unavailable")?
            .insert(id.clone(), sender);
        (self.sink)(json!({"id": id, "request": request}));
        let result = match tokio::time::timeout(INVOCATION_TIMEOUT, receiver).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err("Capability broker response channel closed".into()),
            Err(_) => Err("Capability command timed out".into()),
        };
        self.pending
            .lock()
            .map_err(|_| "Capability broker requests unavailable")?
            .remove(&id);
        result
    }

    pub fn respond(&self, id: &str, response: Value) -> Result<(), String> {
        let sender = self
            .pending
            .lock()
            .map_err(|_| "Capability broker requests unavailable")?
            .remove(id)
            .ok_or("Capability broker request is no longer pending")?;
        sender
            .send(response)
            .map_err(|_| "Capability broker request is no longer pending".to_string())
    }

    #[cfg(unix)]
    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        use std::os::unix::fs::{FileTypeExt, PermissionsExt};
        if let Ok(metadata) = std::fs::symlink_metadata(&self.endpoint.socket_path) {
            if !metadata.file_type().is_socket() {
                return Err("Capability relay path exists and is not a socket".into());
            }
            std::fs::remove_file(&self.endpoint.socket_path).map_err(|error| error.to_string())?;
        }
        let listener = tokio::net::UnixListener::bind(&self.endpoint.socket_path)
            .map_err(|error| format!("Could not start capability relay: {error}"))?;
        std::fs::set_permissions(
            &self.endpoint.socket_path,
            std::fs::Permissions::from_mode(0o600),
        )
        .map_err(|error| error.to_string())?;
        let weak = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let weak = weak.clone();
                tokio::spawn(async move {
                    let _ = handle_connection(weak, stream).await;
                });
            }
        });
        Ok(())
    }

    #[cfg(not(unix))]
    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        Err("Native capability relay currently requires Unix process support".into())
    }
}

impl Drop for CapabilityBridge {
    fn drop(&mut self) {
        #[cfg(unix)]
        if std::fs::symlink_metadata(&self.endpoint.socket_path)
            .ok()
            .is_some_and(|metadata| {
                std::os::unix::fs::FileTypeExt::is_socket(&metadata.file_type())
            })
        {
            let _ = std::fs::remove_file(&self.endpoint.socket_path);
        }
    }
}

fn relay_token() -> String {
    let mut bytes = [0u8; 32];
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_err()
    {
        let seed = format!(
            "{}:{}:{:?}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            std::thread::current().id()
        );
        bytes.copy_from_slice(&Sha256::digest(seed.as_bytes()));
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(unix)]
async fn handle_connection(
    bridge: Weak<CapabilityBridge>,
    stream: tokio::net::UnixStream,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    let (read, mut write) = stream.into_split();
    let mut line = String::new();
    let mut limited = BufReader::new(read).take(MAX_REQUEST_BYTES + 1);
    limited
        .read_line(&mut line)
        .await
        .map_err(|error| error.to_string())?;
    let response = if line.len() as u64 > MAX_REQUEST_BYTES {
        json!({"ok":false,"error":{"code":"REQUEST_TOO_LARGE","message":"Capability request exceeds 1 MB"}})
    } else if let Some(bridge) = bridge.upgrade() {
        match serde_json::from_str::<RelayRequest>(&line) {
            Ok(envelope) if envelope.token == bridge.endpoint.token => {
                bridge.request(envelope.request).await.unwrap_or_else(
                    |message| json!({"ok":false,"error":{"code":"RELAY_FAILED","message":message}}),
                )
            }
            _ => {
                json!({"ok":false,"error":{"code":"UNAUTHORIZED","message":"Capability relay request was rejected"}})
            }
        }
    } else {
        json!({"ok":false,"error":{"code":"RELAY_UNAVAILABLE","message":"Capability relay is unavailable"}})
    };
    write
        .write_all(response.to_string().as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    write
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())
}

#[cfg(unix)]
pub async fn relay_request(
    endpoint: &CapabilityRelayEndpoint,
    request: Value,
) -> Result<Value, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let stream = tokio::net::UnixStream::connect(&endpoint.socket_path)
        .await
        .map_err(|error| format!("Could not connect to Nooki capability relay: {error}"))?;
    let (read, mut write) = stream.into_split();
    let envelope = RelayRequest {
        token: endpoint.token.clone(),
        request,
    };
    write
        .write_all(
            serde_json::to_string(&envelope)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .await
        .map_err(|error| error.to_string())?;
    write
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    let mut line = String::new();
    BufReader::new(read)
        .read_line(&mut line)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&line).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn request_waits_for_renderer_response() {
        let root =
            std::env::temp_dir().join(format!("nooki-capability-bridge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (events, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let bridge = Arc::new(
            CapabilityBridge::new(
                &root,
                Arc::new(move |event| {
                    let _ = events.send(event);
                }),
            )
            .unwrap(),
        );
        bridge.renderer_ready();
        let request_bridge = bridge.clone();
        let pending = tokio::spawn(async move {
            request_bridge
                .request(json!({"action":"search"}))
                .await
                .unwrap()
        });
        let event = receiver.recv().await.unwrap();
        bridge
            .respond(
                event["id"].as_str().unwrap(),
                json!({"ok":true,"action":"search","commands":[]}),
            )
            .unwrap();
        assert!(bridge
            .respond(event["id"].as_str().unwrap(), json!({"ok":true}))
            .is_err());
        assert_eq!(pending.await.unwrap()["ok"], true);
        drop(bridge);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn socket_rejects_bad_tokens_and_relays_authenticated_requests() {
        let root =
            std::env::temp_dir().join(format!("nooki-capability-relay-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (events, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let bridge = Arc::new(
            CapabilityBridge::new(
                &root,
                Arc::new(move |event| {
                    let _ = events.send(event);
                }),
            )
            .unwrap(),
        );
        bridge.renderer_ready();
        bridge.start().unwrap();
        let endpoint = bridge.endpoint();
        let responder = bridge.clone();
        tokio::spawn(async move {
            let event = receiver.recv().await.unwrap();
            responder
                .respond(
                    event["id"].as_str().unwrap(),
                    json!({"ok":true,"action":"describe"}),
                )
                .unwrap();
        });
        assert_eq!(
            relay_request(&endpoint, json!({"action":"describe"}))
                .await
                .unwrap()["ok"],
            true
        );
        let mut bad = endpoint;
        bad.token = "wrong".into();
        assert_eq!(
            relay_request(&bad, json!({"action":"search"}))
                .await
                .unwrap()["error"]["code"],
            "UNAUTHORIZED"
        );
        drop(bridge);
        let _ = std::fs::remove_dir_all(root);
    }
}
