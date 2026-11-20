//! Host-controller authority for the first board mutation. No renderer command exposes issuance.
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvocationContext {
    pub capability_id: String,
    pub capability_version: String,
    pub generation: String,
}

struct Invocation { caller: String, context: InvocationContext }
#[derive(Default)]
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
        let handle = nonce()?;
        if self.invocations.contains_key(&handle) { return Err("RESOURCE_UNAVAILABLE: invocation identity collision".into()); }
        self.invocations.insert(handle.clone(), Invocation { caller:caller.into(), context });
        Ok(handle)
    }
    pub fn context(&self, caller: &str, handle: &str, operation: &str, resource: &str) -> Result<&InvocationContext, String> {
        let entry = self.invocations.get(handle).ok_or("PERMISSION_DENIED: unknown or revoked invocation")?;
        if entry.caller != caller || operation != "board.create" || resource != "board" {
            return Err("PERMISSION_DENIED: invocation scope mismatch".into());
        }
        Ok(&entry.context)
    }
    pub fn revoke(&mut self, caller: &str, handle: &str) -> Result<(), String> {
        self.context(caller, handle, "board.create", "board")?;
        self.invocations.remove(handle);
        Ok(())
    }
    pub fn invalidate(&mut self, capability_id: &str) {
        self.invocations.retain(|_, entry| entry.context.capability_id != capability_id);
    }
}
