//! Host-owned approval sessions for trusted legacy UI. Not a shared-realm malicious-code boundary.
use crate::{capability_authority::InvocationContext, capability_runtime::PlatformState, document_grants::{self, DocumentGrant, DocumentAccess}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, time::{Duration, Instant}};

pub(crate) struct Selection {
  pub context: InvocationContext,
  pub purpose: String,
  request_id: String,
  limit: usize,
  ids: Option<BTreeSet<String>>,
  expires_at: Instant,
}
#[derive(Debug, Serialize)]
pub struct SelectionError { code: &'static str, message: &'static str }
fn error(code: &'static str) -> SelectionError {
  SelectionError { code, message: match code {
    "INVALID_INPUT" => "Invalid document selection request",
    "PERMISSION_DENIED" => "Document access is not authorized for this installation",
    "CONFLICT" => "The approved selection changed; cancel and select again",
    "RESOURCE_LIMIT" => "Too many open document selections; close an existing picker",
    "RESOURCE_BUSY" => "Document data is busy; retry after the current operation finishes",
    "OUTCOME_UNKNOWN" => "The selection outcome is unknown; retry the same approved selection",
    _ => "Document selection is unavailable",
  } }
}
fn native_error(value: String, dispatched: bool) -> SelectionError {
  let code = match value.split(':').next().unwrap_or("") {
    "PERMISSION_DENIED" => "PERMISSION_DENIED", "INVALID_INPUT" => "INVALID_INPUT",
    "RESOURCE_BUSY" => "RESOURCE_BUSY", "CONFLICT" => "CONFLICT", "OUTCOME_UNKNOWN" => "OUTCOME_UNKNOWN",
    _ if dispatched => "OUTCOME_UNKNOWN", _ => "RESOURCE_UNAVAILABLE",
  };
  error(code)
}
fn request<T: serde::de::DeserializeOwned>(caller: &str, value: Value) -> Result<T, SelectionError> {
  if caller != "main" { return Err(error("PERMISSION_DENIED")); }
  if serde_json::to_vec(&value).map_err(|_| error("INVALID_INPUT"))?.len() > 65_536 { return Err(error("INVALID_INPUT")); }
  serde_json::from_value(value).map_err(|_| error("INVALID_INPUT"))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Begin { request_id: String, capability_id: String, version: String, purpose: String, limit: usize }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Commit { handle: String, ids: Vec<String> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cancellation { request_id: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revoke { id: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

pub fn begin(state: &PlatformState, caller: &str, value: Value) -> Result<Value, SelectionError> {
  let input: Begin = request(caller, value)?;
  if input.request_id.is_empty() || input.request_id.len() > 100 || !input.request_id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') || input.purpose.trim().is_empty() || input.purpose.chars().count() > 1000 || !(1..=50).contains(&input.limit) { return Err(error("INVALID_INPUT")); }
  state.prepare_document_grant(&input.capability_id).map_err(|e| native_error(e,false))?;
  let context = state.with_document_authority(&input.capability_id, |context| Ok(context.clone())).map_err(|e| native_error(e,false))?;
  if context.capability_version != input.version { return Err(error("PERMISSION_DENIED")); }
  let mut pending = state.document_selections.lock().map_err(|_| error("RESOURCE_UNAVAILABLE"))?;
  // Reclaim abandoned sessions on the next request, including replies lost with a closed page.
  pending.retain(|_, selection| selection.expires_at > Instant::now());
  if let Some((handle, existing)) = pending.iter().find(|(_, selection)| selection.request_id == input.request_id) {
    if existing.context != context || existing.purpose != input.purpose || existing.limit != input.limit { return Err(error("CONFLICT")); }
    return Ok(json!({"handle":handle,"requestId":input.request_id,"capabilityId":input.capability_id,"version":input.version}));
  }
  if pending.len() >= 16 { return Err(error("RESOURCE_LIMIT")); }
  let handle = crate::capability_authority::nonce().map_err(|e| native_error(e,false))?;
  if pending.contains_key(&handle) { return Err(error("RESOURCE_UNAVAILABLE")); }
  pending.insert(handle.clone(), Selection { request_id:input.request_id.clone(), context, purpose: input.purpose, limit: input.limit, ids:None, expires_at:Instant::now() + Duration::from_secs(15 * 60) });
  Ok(json!({"handle":handle,"requestId":input.request_id,"capabilityId":input.capability_id,"version":input.version}))
}
pub fn commit(state: &PlatformState, caller: &str, value: Value) -> Result<DocumentGrant, SelectionError> {
  let input: Commit = request(caller,value)?;
  // Cancel and commit are ordered; a commit accepted before cancellation keeps the user's grant.
  let mut pending = state.document_selections.lock().map_err(|_| error("RESOURCE_UNAVAILABLE"))?;
  // Reclaim abandoned sessions on the next request, including replies lost with a closed page.
  pending.retain(|_, selection| selection.expires_at > Instant::now());
  let selection = pending.get_mut(&input.handle).ok_or_else(|| error("PERMISSION_DENIED"))?;
  let ids: BTreeSet<_> = input.ids.iter().cloned().collect();
  if ids.is_empty() || ids.len() > selection.limit || input.ids.len() > 50 { return Err(error("INVALID_INPUT")); }
  if selection.ids.as_ref().is_some_and(|approved| approved != &ids) { return Err(error("CONFLICT")); }
  selection.ids = Some(ids);
  document_grants::grant_for_selection(state,state.data_dir(),&selection.context.capability_id,input.ids,&input.handle,Some(selection))
    .map_err(|e| native_error(e,true))
}
pub fn cancel(state: &PlatformState, caller: &str, value: Value) -> Result<(), SelectionError> {
  let input: Cancellation = request(caller,value)?;
  state.document_selections.lock().map_err(|_| error("RESOURCE_UNAVAILABLE"))?.retain(|_,selection| selection.request_id != input.request_id);
  Ok(())
}
pub fn revoke(state: &PlatformState, caller: &str, value: Value) -> Result<(), SelectionError> {
  let input: Revoke = request(caller,value)?;
  state.revoke_document_grant(&input.id).map_err(|e| native_error(e,true))
}
pub fn accesses(state: &PlatformState, caller: &str, value: Value) -> Result<Vec<DocumentAccess>, SelectionError> {
  let _: Empty = request(caller,value)?;
  document_grants::access_records(state).map_err(|e| native_error(e,false))
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn expired_sessions_release_capacity_and_cannot_capture_documents() {
    let root=std::env::temp_dir().join(format!("nooki-selection-expiry-{}",crate::capability_authority::nonce().unwrap()));
    let state=PlatformState::load(root.clone()).unwrap();
    state.document_selections.lock().unwrap().insert("expired".into(),Selection {
      context:InvocationContext { capability_id:"example.reader".into(),capability_version:"0.1.0".into(),generation:"old".into() },
      request_id:"lost".into(),purpose:"Read".into(),limit:1,ids:None,expires_at:std::time::Instant::now(),
    });
    assert!(commit(&state,"main",json!({"handle":"expired","ids":["one"]})).is_err());
    assert!(state.document_selections.lock().unwrap().is_empty());
    assert!(!root.join("document-grants").exists());
    let _=std::fs::remove_dir_all(root);
  }
}
