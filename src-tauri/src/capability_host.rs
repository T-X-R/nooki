//! Native adapter: transport identity is supplied by Tauri, never by the request body.
//! Issuance stays in the trusted controller; this adapter cannot grant itself authority.
use crate::capability_runtime::PlatformState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct HostError { code: &'static str, message: &'static str }

impl HostError {
    fn from_native(error: &str, dispatched: bool) -> Self {
        let (code, message) = match error.split_once(':').map(|(code, _)| code) {
            Some("INVALID_INPUT") => ("INVALID_INPUT", "Invalid board create request"),
            Some("PERMISSION_DENIED") => ("PERMISSION_DENIED", "Board create authority is missing or no longer valid"),
            Some("CONFLICT") => ("CONFLICT", "The idempotency key was used with different input"),
            Some("RESOURCE_LIMIT" | "INVOCATION_LIMIT") => ("RESOURCE_LIMIT", "Board create capacity is exhausted"),
            Some("RESOURCE_BUSY") => ("RESOURCE_BUSY", "The native owner is busy; retry with the same key and input"),
            Some("UNSUPPORTED_SERVICE") => ("UNSUPPORTED_SERVICE", "This board operation is not supported"),
            Some("RESOURCE_UNAVAILABLE") => ("RESOURCE_UNAVAILABLE", "Board create is unavailable"),
            Some("OUTCOME_UNKNOWN") => ("OUTCOME_UNKNOWN", "The outcome is unknown; retry with the same key and input"),
            _ if dispatched => ("OUTCOME_UNKNOWN", "The outcome is unknown; retry with the same key and input"),
            _ => ("RESOURCE_UNAVAILABLE", "Board create is unavailable"),
        };
        Self { code, message }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BoardCreateRequest { handle: String, key: String, input: Value }

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
        || result["revision"].as_u64() != Some(1) {
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
