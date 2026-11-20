use serde_json::{json, Value};
use std::{collections::{BTreeMap, VecDeque}, sync::{Arc, Mutex}};
use sha2::{Digest, Sha256};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::UnixStream, task::JoinHandle};
pub const EVENT_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct LivePool(Arc<Mutex<Counts>>);
struct Counts {
    limits: (usize, usize, usize, usize),
    owners: BTreeMap<String, (usize, usize)>,
    count: usize,
    bytes: usize,
}
struct Lease { pool: LivePool, owner: String, bytes: usize }
impl LivePool {
    pub fn new(per_count: usize, total_count: usize, per_bytes: usize, total_bytes: usize) -> Self {
        Self(Arc::new(Mutex::new(Counts { limits:(per_count,total_count,per_bytes,total_bytes),owners:BTreeMap::new(),count:0,bytes:0 })))
    }
    pub fn snapshot(&self) -> Value {
        let c = self.0.lock().unwrap();
        json!({"count":c.count,"bytes":c.bytes,"owners":c.owners})
    }
    fn acquire(&self, owner: &str, bytes: usize) -> Result<Lease, String> {
        // Fixed synthetic owners; this is not production caller authentication.
        if !matches!(owner, "a" | "b" | "c") { return Err("unknown owner".into()); }
        let mut c = self.0.lock().unwrap();
        let (count, held) = c.owners.get(owner).copied().unwrap_or_default();
        if count >= c.limits.0 || bytes > c.limits.2 - held { return Err("owner resource limit; release or retry".into()); }
        if c.count >= c.limits.1 || bytes > c.limits.3 - c.bytes { return Err("host resource limit; release or retry".into()); }
        c.owners.insert(owner.into(), (count + 1, held + bytes)); c.count += 1; c.bytes += bytes;
        Ok(Lease { pool:self.clone(), owner:owner.into(), bytes })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut c = self.pool.0.lock().unwrap();
        let held = c.owners.get_mut(&self.owner).unwrap();
        held.0 -= 1; held.1 -= self.bytes;
        if held.0 == 0 { c.owners.remove(&self.owner); }
        c.count -= 1; c.bytes -= self.bytes;
    }
}
pub struct Events { pool: LivePool, queue: VecDeque<Event> }
// Drop payload before its lease; a delivered Event remains charged until dropped.
pub struct Event { bytes: Vec<u8>, lease: Lease }
impl Event { pub fn bytes(&self) -> &[u8] { &self.bytes } }
impl Events {
    pub fn new(pool: LivePool) -> Self { Self { pool, queue:VecDeque::new() } }
    pub fn push(&mut self, owner: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > EVENT_BYTES { return Err("event bytes exceeded".into()); }
        let lease = self.pool.acquire(owner, bytes.len())?;
        self.queue.push_back(Event { bytes:bytes.into(), lease });
        Ok(())
    }
    pub fn pop(&mut self) -> Option<Event> { self.queue.pop_front() }
    pub fn discard_owner(&mut self, owner: &str) { self.queue.retain(|event| event.lease.owner != owner); }
}
pub struct OwnedTask { handle: Option<JoinHandle<()>> }
impl OwnedTask {
    pub async fn run(pool: &LivePool, owner: &str) -> Result<(Self, [u8; 32]), String> {
        let lease = pool.acquire(owner, 0)?;
        struct RunData { payload: Vec<u8>, _lease: Lease }
        let data = RunData { payload:vec![42; 64 * 1024], _lease:lease };
        let (ready, started) = tokio::sync::oneshot::channel();
        let task = Self { handle:Some(tokio::spawn(async move {
            let digest: [u8; 32] = Sha256::digest(&data.payload).into();
            let _ = ready.send(digest);
            std::future::pending::<()>().await;
            drop(data);
        })) };
        let digest = started.await.map_err(|error| error.to_string())?;
        Ok((task, digest))
    }
    pub async fn service(pool: &LivePool, owner: &str) -> Result<(Self, UnixStream), String> {
        let lease = pool.acquire(owner, 0)?;
        let (stream, peer) = UnixStream::pair().map_err(|error| error.to_string())?;
        struct ServiceData { stream: UnixStream, _lease: Lease }
        let mut data = ServiceData { stream, _lease:lease };
        Ok((Self { handle:Some(tokio::spawn(async move {
            if data.stream.write_all(b"ready").await.is_ok() {
                let mut buffer = [0; 1024];
                while let Ok(count) = data.stream.read(&mut buffer).await {
                    if count == 0 || data.stream.write_all(&buffer[..count]).await.is_err() { break; }
                }
            }
            drop(data);
        })) }, peer))
    }
    pub async fn stop(mut self) {
        let handle = self.handle.take().unwrap();
        handle.abort();
        if let Err(error) = handle.await { assert!(error.is_cancelled(), "unexpected task failure: {error}"); }
    }
}
impl Drop for OwnedTask {
    fn drop(&mut self) { if let Some(handle) = &self.handle { handle.abort(); } }
}
