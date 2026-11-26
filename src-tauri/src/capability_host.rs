//! Native adapter: transport identity is supplied by Tauri, never by the request body.
//! Legacy issuance is main-view only; packages share that trusted realm until R02/R03.
use crate::capability_runtime::PlatformState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct HostError { code: &'static str, message: &'static str }

impl HostError {
    pub(crate) fn from_native(error: &str, dispatched: bool) -> Self {
        let (code, message) = match error.split_once(':').map(|(code, _)| code) {
            Some("INVALID_INPUT") => ("INVALID_INPUT", "Invalid board request"),
            Some("PERMISSION_DENIED") => ("PERMISSION_DENIED", "Board authority is missing or no longer valid"),
            Some("CONFLICT") => ("CONFLICT", "State changed or the idempotency key was used with different input"),
            Some("RESOURCE_LIMIT" | "INVOCATION_LIMIT") => ("RESOURCE_LIMIT", "Board operation capacity is exhausted"),
            Some("RESOURCE_BUSY") => ("RESOURCE_BUSY", "The native owner is busy; retry with the same key and input"),
            Some("UNSUPPORTED_SERVICE") => ("UNSUPPORTED_SERVICE", "This board operation is not supported"),
            Some("RESOURCE_UNAVAILABLE") => ("RESOURCE_UNAVAILABLE", "Board operation is unavailable"),
            Some("OUTCOME_UNKNOWN") => ("OUTCOME_UNKNOWN", "The outcome is unknown; retry with the same key and input"),
            _ if dispatched => ("OUTCOME_UNKNOWN", "The outcome is unknown; retry with the same key and input"),
            _ => ("RESOURCE_UNAVAILABLE", "Board operation is unavailable"),
        };
        Self { code, message }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BoardCreateRequest { handle: String, key: String, input: Value }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoardBeginRequest { capability_id: String, version: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BoardReleaseRequest { handle: String }

fn controller_request<T: serde::de::DeserializeOwned>(caller: &str, value: Value) -> Result<T, HostError> {
    if caller != "main" { return Err(HostError::from_native("PERMISSION_DENIED:", false)); }
    if serde_json::to_vec(&value).map_err(|_| HostError::from_native("INVALID_INPUT:", false))?.len() > 1024 {
        return Err(HostError::from_native("INVALID_INPUT:", false));
    }
    serde_json::from_value(value).map_err(|_| HostError::from_native("INVALID_INPUT:", false))
}

// Host-selected installation plus the permission consent shown during installation. This is a
// trusted shared-renderer controller, not proof of which legacy package script called Tauri.
pub fn board_begin(state: &PlatformState, caller: &str, value: Value) -> Result<String, HostError> {
    let request: BoardBeginRequest = controller_request(caller, value)?;
    state.grant_board_creation(caller, &request.capability_id, &request.version)
        .map_err(|e| HostError::from_native(&e, false))
}

pub fn board_release(state: &PlatformState, caller: &str, value: Value) -> Result<(), HostError> {
    let request: BoardReleaseRequest = controller_request(caller, value)?;
    state.revoke_board_invocation(caller, &request.handle).map_err(|e| HostError::from_native(&e, false))
}

pub fn board_attachment_begin(state: &PlatformState, caller: &str, value: Value) -> Result<String, HostError> {
    let request: BoardBeginRequest = controller_request(caller, value)?;
    state.grant_board_attachment(caller, &request.capability_id, &request.version)
        .map_err(|e| HostError::from_native(&e, false))
}

pub async fn board_attach(state: &PlatformState, native_caller: &str, value: Value) -> Result<Value, HostError> {
    let invalid = || HostError::from_native("INVALID_INPUT:", false);
    if !value.is_object() || serde_json::to_vec(&value).map_err(|_| invalid())?.len() > 65_536 { return Err(invalid()); }
    let request: BoardCreateRequest = serde_json::from_value(value).map_err(|_| invalid())?;
    let wire = json!({"op":crate::task_attachments::ATTACH,"caller":native_caller,"handle":request.handle,"key":request.key,"input":request.input});
    crate::task_attachments::validate_request(&wire).map_err(|e| HostError::from_native(&e, false))?;
    state.with_board_authority(native_caller, &request.handle, crate::task_attachments::OPERATION, "board", |_| Ok(()))
        .map_err(|e| HostError::from_native(&e, false))?;
    let result = crate::task_worker::request(state.data_dir(), wire).await.map_err(|e| HostError::from_native(&e, true))?;
    if result.as_object().is_none_or(|object| object.len() != 2) || result["item"].as_object().is_none_or(|object| object.len() != 2)
        || !result["item"]["id"].as_str().is_some_and(|id| !id.is_empty() && id.len() <= 256)
        || !result["item"]["revision"].as_u64().is_some_and(|r| r > 0 && r <= crate::task_revisions::MAX_REVISION)
        || !result["deliveryId"].as_str().is_some_and(|id| id.len() == 64 && id.bytes().all(|b|b.is_ascii_hexdigit())) {
        return Err(HostError::from_native("OUTCOME_UNKNOWN:", true));
    }
    Ok(result)
}

pub async fn board_create(state: &PlatformState, native_caller: &str, value: Value) -> Result<Value, HostError> {
    let invalid = || HostError::from_native("INVALID_INPUT:", false);
    // Admission bound only: Tauri has already decoded the outer JSON. R02 owns bounded receiving.
    if serde_json::to_vec(&value).map_err(|_| invalid())?.len() > 65_536 { return Err(invalid()); }
    let request: BoardCreateRequest = serde_json::from_value(value).map_err(|_| invalid())?;
    let wire = json!({"op":crate::capability_board::CREATE,"caller":native_caller,
        "handle":request.handle,"key":request.key,"input":request.input});
    crate::capability_board::validate_request(&wire).map_err(|e| HostError::from_native(&e, false))?;
    // Early rejection avoids launching/queueing worker work for revoked or foreign handles.
    // The worker repeats this check under its commit fence; this early check grants no lease.
    state.with_board_authority(native_caller, &request.handle, "board.create", "board", |_| Ok(()))
        .map_err(|e| HostError::from_native(&e, false))?;
    let result = crate::task_worker::request(state.data_dir(), wire).await
        .map_err(|e| HostError::from_native(&e, true))?;
    if result.as_object().is_none_or(|object| object.len() != 2)
        || !result["id"].as_str().is_some_and(|id| id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()))
        || !result["revision"].as_u64().is_some_and(|revision| revision > 0 && revision <= crate::task_revisions::MAX_REVISION) {
        return Err(HostError::from_native("OUTCOME_UNKNOWN:", true));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn errors_do_not_leak_native_details_or_promise_no_effect_after_transport_failure() {
        assert_eq!(HostError::from_native("private/path/io-error", false).code, "RESOURCE_UNAVAILABLE");
        let error = HostError::from_native("Task command timed out; private/path", true);
        assert_eq!(error.code, "OUTCOME_UNKNOWN");
        assert!(!serde_json::to_string(&error).unwrap().contains("private/path"));
        assert_eq!(HostError::from_native("PERMISSION_DENIED: private handle", true).code, "PERMISSION_DENIED");
    }
}
