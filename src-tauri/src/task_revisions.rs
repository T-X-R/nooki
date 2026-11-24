//! Native-owned, opaque task versions. The retained sequence prevents delete/recreate reuse.
use serde_json::{json, Value};
use std::collections::HashMap;

pub(crate) const MAX_REVISION: u64 = 9_007_199_254_740_991;
fn revision(value: &Value) -> Result<u64, String> {
    value.as_u64().filter(|n| *n > 0 && *n <= MAX_REVISION).ok_or("Invalid task revision".into())
}
fn baseline(board: &Value) -> Result<u64, String> {
    let mut maximum = 0;
    for card in board["cards"].as_array().ok_or("Invalid task board")? {
        if let Some(value) = card.get("revision") { maximum = maximum.max(revision(value)?); }
    }
    for receipt in board["capabilityReceipts"].as_object().into_iter().flat_map(|map| map.values()) {
        maximum = maximum.max(revision(&receipt["result"]["revision"])?);
    }
    if let Some(value) = board.get("revisionSequence") {
        let sequence = value.as_u64().filter(|n| *n <= MAX_REVISION && *n >= maximum).ok_or("Invalid task revision sequence")?;
        maximum = sequence;
    }
    Ok(maximum)
}
pub(crate) fn validate(board: &Value) -> Result<(), String> { baseline(board).map(|_| ()) }
fn advance(sequence: u64) -> Result<u64, String> {
    sequence.checked_add(1).filter(|n| *n <= MAX_REVISION).ok_or("RESOURCE_LIMIT: task revision sequence exhausted".into())
}
pub(crate) fn next(board: &Value) -> Result<u64, String> { advance(baseline(board)?) }

// Legacy reads normalize in memory only; subsequent commits persist the same deterministic versions.
pub(crate) fn migrate(board: &mut Value) -> Result<(), String> {
    let mut sequence = baseline(board)?;
    for card in board["cards"].as_array_mut().unwrap() {
        if card.get("revision").is_none() {
            sequence = advance(sequence)?;
            card["revision"] = json!(sequence);
        }
    }
    board["revisionSequence"] = json!(sequence);
    Ok(())
}

// Call under the task-data lock. Incoming version fields never choose the committed version.
pub(crate) fn prepare(current: &Value, incoming: &mut Value) -> Result<(), String> {
    let mut sequence = baseline(current)?;
    let previous: HashMap<_, _> = current["cards"].as_array().unwrap().iter()
        .filter_map(|card| card["id"].as_str().map(|id| (id, card))).collect();
    for card in incoming["cards"].as_array_mut().ok_or("Invalid task board")? {
        let old = card["id"].as_str().and_then(|id| previous.get(id)).copied();
        let object = card.as_object_mut().ok_or("Invalid task card")?;
        object.remove("revision");
        if let Some(old) = old {
            let mut content = old.as_object().unwrap().clone(); content.remove("revision");
            if *object == content { object.insert("revision".into(), old["revision"].clone()); continue; }
        }
        sequence = advance(sequence)?;
        object.insert("revision".into(), json!(sequence));
    }
    incoming["revisionSequence"] = json!(sequence);
    Ok(())
}
