//! Host-controller authority for the first board mutation. No renderer command exposes issuance.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::{self, File, OpenOptions}, io::{Read, Write}, path::Path, time::{Duration, Instant}};

const LIVE_FILE: &str = "capability-invocations.json";
const MAX_LIVE_BYTES: usize = 512 * 1024;

// This file coordinates native processes, not recovery. Only digests are persisted; startup clears it.
pub(crate) fn fence(root: &Path) -> Result<File, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(file) = crate::task_worker::file_lock(&root.join("capability-authority.lock"))? { return Ok(file); }
        if Instant::now() >= deadline { return Err("RESOURCE_BUSY: authority transaction in progress; retry later".into()); }
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn digest(handle: &str) -> Result<String, String> {
    if handle.len() != 64 || !handle.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("PERMISSION_DENIED: invalid invocation".into());
    }
    Ok(format!("{:x}", Sha256::digest(handle.as_bytes())))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InvocationContext {
    pub capability_id: String,
    pub capability_version: String,
    pub generation: String,
}

#[derive(Serialize, Deserialize)]
struct Invocation { caller: String, context: InvocationContext }
#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Authority { invocations: BTreeMap<String, Invocation> }

pub(crate) fn nonce() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    // Use the platform CSPRNG; never substitute a predictable fallback.
    getrandom::fill(&mut bytes)
        .map_err(|_| "RESOURCE_UNAVAILABLE: native randomness unavailable")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

impl Authority {
    pub fn issue(&mut self, caller: &str, context: InvocationContext) -> Result<String, String> {
        if caller.is_empty() || caller.len() > 128 || !caller.is_ascii() { return Err("INVALID_INPUT: native caller missing or invalid".into()); }
        if self.invocations.len() >= 256 || self.invocations.values().filter(|entry| entry.context.capability_id == context.capability_id).count() >= 16 {
            return Err("INVOCATION_LIMIT: release an existing invocation".into());
        }
        if context.capability_id.len() > 256 || context.capability_version.len() > 256 || context.generation.len() != 64 {
            return Err("INVALID_INPUT: invocation context exceeds supported bounds".into());
        }
        let handle = nonce()?;
        let key = digest(&handle)?;
        if self.invocations.contains_key(&key) { return Err("RESOURCE_UNAVAILABLE: invocation identity collision".into()); }
        self.invocations.insert(key, Invocation { caller:caller.into(), context });
        Ok(handle)
    }
    pub fn context(&self, caller: &str, handle: &str, operation: &str, resource: &str) -> Result<&InvocationContext, String> {
        let entry = self.invocations.get(&digest(handle)?).ok_or("PERMISSION_DENIED: unknown or revoked invocation")?;
        if entry.caller != caller || operation != "board.create" || resource != "board" {
            return Err("PERMISSION_DENIED: invocation scope mismatch".into());
        }
        Ok(&entry.context)
    }
    pub fn revoke(&mut self, caller: &str, handle: &str) -> Result<(), String> {
        self.context(caller, handle, "board.create", "board")?;
        self.invocations.remove(&digest(handle)?);
        Ok(())
    }
    pub fn retain_current(&mut self, current: impl Fn(&InvocationContext) -> bool) {
        self.invocations.retain(|_, entry| current(&entry.context));
    }

    // All callers must hold fence(root), including startup reset and registry commit.
    pub fn load(root: &Path) -> Result<Self, String> {
        let file = match File::open(root.join(LIVE_FILE)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error.to_string()),
        };
        let mut bytes = Vec::new();
        file.take((MAX_LIVE_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_LIVE_BYTES { return Err("RESOURCE_UNAVAILABLE: authority record exceeds byte limit".into()); }
        let record: Self = serde_json::from_slice(&bytes).map_err(|_| "RESOURCE_UNAVAILABLE: invalid authority record")?;
        if record.invocations.len() > 256 { return Err("RESOURCE_UNAVAILABLE: authority record exceeds count limit".into()); }
        Ok(record)
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_LIVE_BYTES { return Err("INVOCATION_LIMIT: authority record exceeds byte limit".into()); }
        let path = root.join(LIVE_FILE);
        let staging = path.with_extension("json.tmp");
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&staging).map_err(|e| e.to_string())?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        }
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        fs::rename(staging, path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(root).and_then(|directory| directory.sync_all())
            .map_err(|_| "OUTCOME_UNKNOWN: authority changed but durability acknowledgement failed".to_string())?;
        Ok(())
    }
}
