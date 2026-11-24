//! Host-owned task approval for trusted legacy UI, not a shared-realm malicious-code boundary.
use crate::{capability_authority::InvocationContext, capability_runtime::{PlatformState, CapabilityPermission}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{BTreeMap, BTreeSet}, fs, io::Write, path::Path, time::{Duration, Instant}};

const OPERATION: &str = "attachDelivery";
const EPOCH_FILE: &str = "task-grant-epoch.json"; // Deliberately outside user-data backup roots.
const MAX_GRANTS: usize = 1024;
const MAX_PACKAGE_GRANTS: usize = 256;
const MAX_GRANT_BYTES: usize = 2 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct Item { pub id: String, pub revision: u64 }
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct GrantedItem { id: String, revision: u64, title: String }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Grant { context: InvocationContext, epoch: String, purpose: String, items: Vec<GrantedItem>, created_at: String, revoked: bool }
pub(crate) struct Selection {
    context: InvocationContext, epoch: String, purpose: String, request_id: String,
    limit: usize, items: Option<Vec<Item>>, expires_at: Instant,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Begin { request_id: String, capability_id: String, version: String, purpose: String, operations: Vec<String>, limit: usize }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Commit { handle: String, items: Vec<Item> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cancel { request_id: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revoke { id: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
fn request<T: serde::de::DeserializeOwned>(caller: &str, value: Value) -> Result<T, String> {
    if caller != "main" { return Err("PERMISSION_DENIED: task selection requires the host controller".into()); }
    if !value.is_object() || serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 65_536 {
        return Err("INVALID_INPUT: invalid task selection envelope".into());
    }
    serde_json::from_value(value).map_err(|_| "INVALID_INPUT: invalid task selection request".into())
}
fn hex(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) }
fn item_valid(item: &Item) -> bool { !item.id.is_empty() && item.id.len() <= 256 && item.revision > 0 && item.revision <= crate::task_revisions::MAX_REVISION }
fn context(root: &Path, id: &str) -> Result<InvocationContext, String> {
    crate::capability_runtime::selection_context(root, id, CapabilityPermission::BoardAttachDelivery)
}
fn epoch(root: &Path) -> Result<Option<String>, String> {
    match fs::read(root.join(EPOCH_FILE)) {
        Ok(bytes) => {
            let value: String = serde_json::from_slice(&bytes).map_err(|_| "RESOURCE_UNAVAILABLE: invalid task grant epoch")?;
            if !hex(&value) { return Err("RESOURCE_UNAVAILABLE: invalid task grant epoch".into()); }
            Ok(Some(value))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
fn rotate_epoch(root: &Path) -> Result<String, String> {
    let value = crate::capability_authority::nonce()?;
    let path = root.join(EPOCH_FILE); let pending = path.with_extension("pending");
    let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(&value).map_err(|e| e.to_string())?).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    fs::rename(pending, path).map_err(|e| e.to_string())?;
    fs::File::open(root).and_then(|file| file.sync_all()).map_err(|_| "OUTCOME_UNKNOWN: task grant epoch durability is uncertain")?;
    Ok(value)
}
// Restore/recovery hold task-data.lock. Never import this epoch from an archive.
pub(crate) fn invalidate_for_restore(root: &Path) -> Result<(), String> {
    if root.join(EPOCH_FILE).try_exists().map_err(|e| e.to_string())? { rotate_epoch(root)?; }
    Ok(())
}
fn records(board: &Value) -> Result<BTreeMap<String, Grant>, String> {
    let Some(value) = board.get("taskGrants") else { return Ok(BTreeMap::new()); };
    if !value.is_object() || serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > MAX_GRANT_BYTES {
        return Err("RESOURCE_LIMIT: task grant metadata exceeds its byte bound".into());
    }
    if value.as_object().unwrap().values().any(|grant| !grant.is_object() || !grant["context"].is_object()
        || grant["context"].as_object().is_some_and(|context| context.len() != 3)
        || grant["items"].as_array().is_some_and(|items| items.iter().any(|item| !item.is_object()))) {
        return Err("Invalid task grant objects".into());
    }
    let grants: BTreeMap<String, Grant> = serde_json::from_value(value.clone()).map_err(|_| "Invalid task grants")?;
    if grants.len() > MAX_GRANTS { return Err("RESOURCE_LIMIT: task grant capacity exceeded".into()); }
    let mut counts = BTreeMap::<&str, usize>::new();
    for (id, grant) in &grants {
        let mut ids = BTreeSet::new();
        if !hex(id) || !hex(&grant.epoch) || !hex(&grant.context.generation)
            || grant.context.capability_id.is_empty() || grant.context.capability_id.len() > 256
            || semver::Version::parse(&grant.context.capability_version).is_err()
            || grant.purpose.trim().is_empty() || grant.purpose.chars().count() > 1000
            || chrono::DateTime::parse_from_rfc3339(&grant.created_at).is_err()
            || grant.items.is_empty() || grant.items.len() > 50
            || grant.items.iter().any(|item| !item_valid(&Item { id:item.id.clone(), revision:item.revision })
                || item.title.trim().is_empty() || item.title.chars().count() > 120 || !ids.insert(&item.id)) {
            return Err("Invalid task grant".into());
        }
        let count = counts.entry(&grant.context.capability_id).or_default(); *count += 1;
        if *count > MAX_PACKAGE_GRANTS { return Err("RESOURCE_LIMIT: package task grant capacity exceeded".into()); }
    }
    Ok(grants)
}
pub(crate) fn validate(board: &Value) -> Result<(), String> { records(board).map(|_| ()) }
fn metadata(id: &str, grant: &Grant) -> Value {
    json!({"id":id,"capabilityId":grant.context.capability_id,"capabilityVersion":grant.context.capability_version,
        "purpose":grant.purpose,"operations":[OPERATION],"items":grant.items,"createdAt":grant.created_at})
}
fn current_item<'a>(board: &'a Value, item: &Item) -> Result<&'a Value, String> {
    board["cards"].as_array().unwrap().iter().find(|card| card["id"] == item.id && card["revision"] == item.revision)
        .ok_or("CONFLICT: selected task changed or was removed".into())
}
// The attachment transaction must hold task-data.lock and the authority fence throughout its effect.
// Its InvocationContext comes from the native invocation owner, never from a package request body.
pub fn authorize(root: &Path, board: &Value, invocation: &InvocationContext, grant_id: &str, item: &Item, operation: &str) -> Result<(), String> {
    crate::user_data::ensure_restore_complete(root)?;
    if operation != OPERATION || context(root, &invocation.capability_id)? != *invocation {
        return Err("PERMISSION_DENIED: task operation or installation is not authorized".into());
    }
    let grants = records(board)?;
    let grant = grants.get(grant_id).ok_or("PERMISSION_DENIED: unknown task grant")?;
    if grant.revoked || grant.context != *invocation || epoch(root)?.as_ref() != Some(&grant.epoch)
        || !grant.items.iter().any(|selected| selected.id == item.id && selected.revision == item.revision) {
        return Err("PERMISSION_DENIED: task is outside the active selection".into());
    }
    current_item(board, item)?;
    Ok(())
}

pub fn begin(state: &PlatformState, caller: &str, value: Value) -> Result<Value, String> {
    let input: Begin = request(caller, value)?;
    if input.request_id.is_empty() || input.request_id.len() > 100
        || !input.request_id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || input.purpose.trim().is_empty() || input.purpose.chars().count() > 1000 || !(1..=50).contains(&input.limit)
        || input.operations != [OPERATION] { return Err("INVALID_INPUT: unsupported task selection".into()); }
    state.prepare_selection_grant(&input.capability_id, CapabilityPermission::BoardAttachDelivery)?;
    let root = state.data_dir();
    let (context, epoch) = {
        let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
        crate::user_data::ensure_restore_complete(root)?;
        let _fence = crate::capability_authority::fence(root)?;
        let context = context(root, &input.capability_id)?;
        if context.capability_version != input.version { return Err("PERMISSION_DENIED: task selection installation changed".into()); }
        let epoch = match epoch(root)? { Some(epoch) => epoch, None => rotate_epoch(root)? };
        (context, epoch)
    };
    let mut pending = state.task_selections.lock().map_err(|_| "RESOURCE_UNAVAILABLE: selections unavailable")?;
    pending.retain(|_, selection| selection.expires_at > Instant::now());
    if let Some((handle, selection)) = pending.iter().find(|(_, selection)| selection.request_id == input.request_id) {
        if selection.context != context || selection.epoch != epoch || selection.purpose != input.purpose || selection.limit != input.limit {
            return Err("CONFLICT: task selection request identity changed".into());
        }
        return Ok(json!({"handle":handle,"requestId":input.request_id,"capabilityId":input.capability_id,"version":input.version}));
    }
    if pending.len() >= 16 { return Err("RESOURCE_LIMIT: close an existing task picker".into()); }
    let handle = crate::capability_authority::nonce()?;
    if pending.contains_key(&handle) { return Err("RESOURCE_UNAVAILABLE: selection identity collision".into()); }
    pending.insert(handle.clone(), Selection { context,epoch,purpose:input.purpose,request_id:input.request_id.clone(),limit:input.limit,items:None,expires_at:Instant::now()+Duration::from_secs(15*60) });
    Ok(json!({"handle":handle,"requestId":input.request_id,"capabilityId":input.capability_id,"version":input.version}))
}
pub fn commit(state: &PlatformState, caller: &str, value: Value) -> Result<Value, String> {
    if value["items"].as_array().is_some_and(|items| items.iter().any(|item| !item.is_object())) { return Err("INVALID_INPUT: invalid task reference object".into()); }
    let input: Commit = request(caller, value)?;
    let mut pending = state.task_selections.lock().map_err(|_| "RESOURCE_UNAVAILABLE: selections unavailable")?;
    pending.retain(|_, selection| selection.expires_at > Instant::now());
    let selection = pending.get_mut(&input.handle).ok_or("PERMISSION_DENIED: task selection expired or was dismissed")?;
    let mut items = input.items;
    let mut ids = BTreeSet::new();
    if items.is_empty() || items.len() > selection.limit || items.iter().any(|item| !item_valid(item) || !ids.insert(item.id.clone())) {
        return Err("INVALID_INPUT: invalid approved tasks".into());
    }
    items.sort();
    if selection.items.as_ref().is_some_and(|approved| approved != &items) { return Err("CONFLICT: approved task selection changed".into()); }
    selection.items = Some(items.clone()); // Also binds retries after a failed durable write.
    let root = state.data_dir();
    let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    let _fence = crate::capability_authority::fence(root)?;
    if context(root, &selection.context.capability_id)? != selection.context || epoch(root)?.as_ref() != Some(&selection.epoch) {
        return Err("PERMISSION_DENIED: task selection installation or restore epoch changed".into());
    }
    let mut board = crate::task_goals::load(root)?;
    let mut grants = records(&board)?;
    if let Some(grant) = grants.get(&input.handle) {
        if grant.revoked || grant.context != selection.context || grant.epoch != selection.epoch
            || grant.items.iter().map(|i| Item {id:i.id.clone(),revision:i.revision}).collect::<Vec<_>>() != items {
            return Err("PERMISSION_DENIED: task grant is no longer active".into());
        }
        crate::task_goals::confirm_save(root)?;
        return Ok(metadata(&input.handle, grant));
    }
    let mut approved = Vec::new();
    for item in &items {
        let card = current_item(&board, item)?;
        approved.push(GrantedItem { id:item.id.clone(),revision:item.revision,title:card["title"].as_str().unwrap().into() });
    }
    let grant = Grant { context:selection.context.clone(),epoch:selection.epoch.clone(),purpose:selection.purpose.clone(),items:approved,created_at:chrono::Local::now().to_rfc3339(),revoked:false };
    let result = metadata(&input.handle, &grant);
    grants.insert(input.handle, grant);
    board["taskGrants"] = serde_json::to_value(grants).map_err(|e| e.to_string())?;
    crate::task_goals::save(root, &mut board)?;
    Ok(result)
}
pub fn cancel(state: &PlatformState, caller: &str, value: Value) -> Result<(), String> {
    let input: Cancel = request(caller, value)?;
    state.task_selections.lock().map_err(|_| "RESOURCE_UNAVAILABLE: selections unavailable")?.retain(|_, selection| selection.request_id != input.request_id);
    Ok(())
}
pub fn revoke(state: &PlatformState, caller: &str, value: Value) -> Result<(), String> {
    let input: Revoke = request(caller, value)?;
    let root = state.data_dir();
    let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    let _fence = crate::capability_authority::fence(root)?;
    let mut board = crate::task_goals::load(root)?;
    let mut grants = records(&board)?;
    let grant = grants.get_mut(&input.id).ok_or("INVALID_INPUT: unknown task grant")?;
    if grant.revoked { return crate::task_goals::confirm_save(root); }
    grant.revoked = true;
    board["taskGrants"] = serde_json::to_value(grants).map_err(|e| e.to_string())?;
    crate::task_goals::save(root, &mut board)
}
pub fn accesses(state: &PlatformState, caller: &str, value: Value) -> Result<Value, String> {
    let _: Empty = request(caller, value)?;
    let root = state.data_dir();
    let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    let _fence = crate::capability_authority::fence(root)?;
    let board = crate::task_goals::load(root)?;
    let current_epoch = epoch(root)?;
    let mut results = Vec::new();
    for (id, grant) in records(&board)? {
        let status = if grant.revoked { "revoked" }
            else if current_epoch.as_ref() != Some(&grant.epoch) || context(root, &grant.context.capability_id).as_ref() != Ok(&grant.context) { "inactive" }
            else if grant.items.iter().any(|item| current_item(&board,&Item { id:item.id.clone(),revision:item.revision }).is_err()) { "stale" }
            else { "active" };
        results.push(json!({"grant":metadata(&id,&grant),"status":status}));
    }
    results.sort_by(|a,b| b["grant"]["createdAt"].as_str().cmp(&a["grant"]["createdAt"].as_str()));
    Ok(json!(results))
}

#[cfg(test)]
#[path = "task_selection_tests.rs"]
mod tests;
