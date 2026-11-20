//! Explicit user delegation of an existing todo; the worker holds task-data.lock throughout.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Expected { title: String, description: String, sources: Value }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request { op: String, id: String, snapshot_id: String, expected: Expected }
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Receipt { hash: String, committed: bool }

fn snapshot_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
fn receipts(board: &Value) -> Result<BTreeMap<String, Receipt>, String> {
    let Some(value) = board.get("delegationReceipts") else { return Ok(BTreeMap::new()); };
    let records: BTreeMap<String, Receipt> = serde_json::from_value(value.clone()).map_err(|_| "Invalid task delegation receipts")?;
    if records.len() > 1024 || records.iter().any(|(key, receipt)| !snapshot_id(key) || receipt.hash.len() != 64 || !receipt.hash.bytes().all(|c|c.is_ascii_hexdigit())) {
        return Err("Invalid task delegation receipts".into());
    }
    Ok(records)
}
pub(crate) fn validate(board: &Value) -> Result<(), String> { receipts(board).map(|_| ()) }

pub(crate) fn delegate(root: &Path, board: &mut Value, value: Value) -> Result<Value, String> {
    crate::user_data::ensure_restore_complete(root)?;
    let bytes = serde_json::to_vec(&value).map_err(|e|e.to_string())?;
    if bytes.len() > 65_536 { return Err("Task delegation request exceeds 64 KiB".into()); }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let request: Request = serde_json::from_value(value).map_err(|_| "Invalid task delegation request")?;
    if request.op != "delegate" || !snapshot_id(&request.snapshot_id) { return Err("Invalid task delegation identity".into()); }
    let mut records = receipts(board)?;
    if let Some(saved) = records.get(&request.snapshot_id) {
        if saved.hash != hash { return Err("Delegation identity was used with different task content".into()); }
        if saved.committed {
            crate::task_goals::confirm_save(root)?;
            return Ok(board.clone()); // Later edits, withdrawal and removal remain authoritative.
        }
    }
    if records.len() >= 1024 && !records.contains_key(&request.snapshot_id) { return Err("Task delegation receipt capacity is full; existing receipts are retained".into()); }
    let index = board["cards"].as_array().unwrap().iter().position(|card| card["id"] == request.id && card["engine"] != "goals").ok_or("Todo task not found")?;
    let card = &board["cards"][index];
    if card["status"] != "todo" { return Err("Only todo tasks can be delegated".into()); }
    if card["title"] != request.expected.title || card["description"] != request.expected.description { return Err("Task changed; review it before delegating".into()); }
    let sources = card.get("sources").cloned().unwrap_or(json!([]));
    crate::source_snapshots::check_task_source_selection(&sources, &request.expected.sources)?;
    if !records.contains_key(&request.snapshot_id) {
        // Bind the input before a snapshot can outlive a failed queue commit. No authorization yet.
        records.insert(request.snapshot_id.clone(), Receipt { hash: hash.clone(), committed: false });
        board["delegationReceipts"] = serde_json::to_value(&records).map_err(|e|e.to_string())?;
        board["writeToken"] = json!(crate::capability_authority::nonce()?);
        crate::task_goals::save(root, board)?;
    } else { crate::task_goals::confirm_save(root)?; }
    crate::source_snapshots::capture_task(root, &request.snapshot_id, &sources)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis();
    let queued_at = board["cards"].as_array().unwrap().iter().filter_map(|card|card["queuedAt"].as_u64()).max().unwrap_or(0).saturating_add(1) as u128;
    let card = &mut board["cards"][index];
    card["authorization"] = json!({"snapshotId":request.snapshot_id,"documentIds":sources.as_array().unwrap().iter().map(|source|source["id"].clone()).collect::<Vec<_>>()});
    card["status"] = json!("queued"); card["queuedAt"] = json!(now.max(queued_at));
    card.as_object_mut().unwrap().remove("runId"); card.as_object_mut().unwrap().remove("error");
    if card["provenance"]["type"] == "capability" {
        card["revision"] = json!(card["revision"].as_u64().and_then(|n|n.checked_add(1)).filter(|n|*n <= 9_007_199_254_740_991).ok_or("Invalid task revision")?);
    }
    records.insert(request.snapshot_id, Receipt { hash, committed: true });
    board["delegationReceipts"] = serde_json::to_value(records).map_err(|e|e.to_string())?;
    board["writeToken"] = json!(crate::capability_authority::nonce()?);
    crate::task_goals::save(root, board)?;
    Ok(board.clone())
}
