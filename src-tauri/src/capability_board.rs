//! First native Host board mutation. The task worker owns both the item and its replay receipt.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashMap, HashSet}, path::Path};

pub(crate) const CREATE: &str = "capability-create";
const MAX_RECEIPTS: usize = 1024;
const MAX_PACKAGE_RECEIPTS: usize = 256;
const MAX_RECEIPT_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    title: String,
    #[serde(default)] description: String,
    #[serde(default)] sources: Vec<crate::document_grants::DocumentReference>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request { op: String, caller: String, handle: String, key: String, input: Input }
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ItemRef { id: String, revision: u64 }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt { capability_id: String, payload_hash: String, result: ItemRef }
fn hash(value: &impl Serialize) -> Result<String, String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value).map_err(|e| e.to_string())?)))
}
fn hex_id(value: &str) -> bool { value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) }
fn receipts(board: &Value) -> Result<BTreeMap<String, Receipt>, String> {
    let Some(value) = board.get("capabilityReceipts") else { return Ok(BTreeMap::new()); };
    let map = value.as_object().ok_or("Invalid board create receipts")?;
    if map.len() > MAX_RECEIPTS || serde_json::to_vec(value).map_err(|e|e.to_string())?.len() > MAX_RECEIPT_BYTES {
        return Err("RESOURCE_LIMIT: board create receipt capacity exceeded".into());
    }
    let records: BTreeMap<String, Receipt> = serde_json::from_value(value.clone()).map_err(|_| "Invalid board create receipts")?;
    let mut counts = HashMap::<&str, usize>::new();
    let mut ids = HashSet::new();
    for (key, receipt) in &records {
        if !hex_id(key) || !hex_id(&receipt.payload_hash) || !hex_id(&receipt.result.id) || (receipt.result.revision == 0 || receipt.result.revision > crate::task_revisions::MAX_REVISION)
            || receipt.capability_id.is_empty() || receipt.capability_id.len() > 256 || !ids.insert(&receipt.result.id) {
            return Err("Invalid board create receipt".into());
        }
        let count = counts.entry(&receipt.capability_id).or_default(); *count += 1;
        if *count > MAX_PACKAGE_RECEIPTS { return Err("RESOURCE_LIMIT: package board receipt capacity exceeded".into()); }
    }
    Ok(records)
}
pub(crate) fn validate(board: &Value) -> Result<(), String> {
    receipts(board)?;
    if board.get("writeToken").is_some_and(|v| !v.as_str().is_some_and(hex_id)) { return Err("Invalid board write token".into()); }
    Ok(())
}

fn parse_request(request: Value) -> Result<Request, String> {
    if serde_json::to_vec(&request).map_err(|e|e.to_string())?.len() > 65_536 { return Err("INVALID_INPUT: board request exceeds 64 KiB".into()); }
    if let Some(sources) = request["input"]["sources"].as_array() {
        if sources.len() > 50 || sources.iter().any(|source| source.as_object().is_none_or(|object|
            object.len() != 5 || object.keys().any(|key| !["kind","documentId","title","grantId","revision"].contains(&key.as_str())))) {
            return Err("INVALID_INPUT: invalid selected source references".into());
        }
    }
    let request: Request = serde_json::from_value(request).map_err(|_| "INVALID_INPUT: invalid board create request")?;
    if request.op != CREATE || request.key.is_empty() || request.key.len() > 128 || request.key.chars().any(char::is_control)
        || request.input.title.trim().is_empty() || request.input.title.chars().count() > 120 || request.input.description.chars().count() > 20_000 {
        return Err("INVALID_INPUT: invalid board create content or key".into());
    }
    let mut ids = HashSet::new();
    for source in &request.input.sources {
        if source.kind != "library-document" || !ids.insert(&source.document_id)
            || crate::document_library::validate_id(&source.document_id).is_err() {
            return Err("INVALID_INPUT: invalid or duplicate selected source".into());
        }
    }
    Ok(request)
}

pub(crate) fn validate_request(request: &Value) -> Result<(), String> {
    parse_request(request.clone()).map(|_| ())
}

// Called with the worker's task-data lock already held. Only the synchronous effect holds authority.
pub(crate) fn create(root: &Path, board: &mut Value, request: Value) -> Result<Value, String> {
    let request = parse_request(request)?;
    crate::user_data::ensure_restore_complete(root)?;
    crate::capability_runtime::with_worker_board_authority(root, &request.caller, &request.handle, "board.create", "board", |context| {
        let key = hash(&(&context.capability_id, "board.create", &request.key))?;
        let payload_hash = hash(&request.input)?;
        let mut records = receipts(board)?;
        if let Some(receipt) = records.get(&key) {
            if receipt.payload_hash != payload_hash { return Err("CONFLICT: idempotency key was used with different input".into()); }
            // A visible receipt may follow a failed post-rename durability acknowledgement.
            crate::task_goals::confirm_save(root)?;
            return serde_json::to_value(&receipt.result).map_err(|e|e.to_string());
        }
        if records.len() >= MAX_RECEIPTS || records.values().filter(|r| r.capability_id == context.capability_id).count() >= MAX_PACKAGE_RECEIPTS {
            return Err("RESOURCE_LIMIT: board create receipts are full; existing receipts are retained".into());
        }
        let sources = crate::document_grants::board_sources(root, context, &request.input.sources)?;
        let result = ItemRef { id: crate::capability_authority::nonce()?, revision: crate::task_revisions::next(board)? };
        if board["cards"].as_array().unwrap().iter().any(|c| c["id"] == result.id) || records.values().any(|r| r.result.id == result.id) {
            return Err("RESOURCE_UNAVAILABLE: board identity collision".into());
        }
        records.insert(key, Receipt { capability_id:context.capability_id.clone(), payload_hash, result:result.clone() });
        let receipt_bytes = serde_json::to_vec(&records).map_err(|e|e.to_string())?;
        if receipt_bytes.len() > MAX_RECEIPT_BYTES { return Err("RESOURCE_LIMIT: board receipt byte capacity exceeded".into()); }
        let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis();
        board["cards"].as_array_mut().unwrap().push(json!({"id":result.id,"revision":result.revision,"title":request.input.title,
            "description":request.input.description,"sources":sources,"status":"todo","createdAt":created,
            "provenance":{"type":"capability","capabilityId":context.capability_id,"capabilityVersion":context.capability_version}}));
        board["capabilityReceipts"] = serde_json::from_slice(&receipt_bytes).map_err(|e|e.to_string())?;
        board["writeToken"] = json!(crate::capability_authority::nonce()?);
        crate::task_goals::save(root, board)?;
        serde_json::to_value(result).map_err(|e|e.to_string())
    })
}

// Existing UI drafts still use whole-board saves. A stale snapshot must not delete a native create.
pub(crate) fn prepare_legacy(current: &Value, incoming: &mut Value) -> Result<(), String> {
    let object = incoming.as_object_mut().ok_or("Invalid task board")?;
    object.remove("capabilityReceipts"); // Only the native writer owns the retained receipt ledger.
    object.remove("delegationReceipts");
    object.remove("hostDelegations");
    object.remove("taskGrants");
    object.remove("attachmentReceipts");
    object.remove("revisionSequence");
    if current.get("writeToken").is_some() && incoming["writeToken"] != current["writeToken"] {
        return Err("CONFLICT: task board changed; refresh before saving".into());
    }
    for card in incoming["cards"].as_array_mut().ok_or("Invalid task board")? {
        if let Some(object) = card.as_object_mut() { object.remove("revision"); }
        let old = current["cards"].as_array().unwrap().iter().find(|old| old["id"] == card["id"]);
        if let Some(deliveries) = old.and_then(|old| old.get("attachedDeliveries")) {
            card["attachedDeliveries"] = deliveries.clone();
        } else if let Some(object) = card.as_object_mut() { object.remove("attachedDeliveries"); }
        if let Some(old) = old.filter(|old| old["provenance"]["type"] == "capability") {
            card["provenance"] = old["provenance"].clone();
        } else if let Some(object) = card.as_object_mut() {
            object.remove("provenance");
        }
    }
    Ok(())
}
