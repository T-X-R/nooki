//! Append user-owned document deliveries and their replay receipts in one native board commit.
use crate::{capability_authority::InvocationContext, capability_runtime::CapabilityPermission, task_selection::Item};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, path::Path};

pub(crate) const ATTACH: &str = "capability-attach-delivery";
pub(crate) const OPERATION: &str = "board.attachDelivery";
const MAX_RECEIPTS: usize = 1024;
const MAX_PACKAGE_RECEIPTS: usize = 256;
const MAX_RECEIPT_BYTES: usize = 1024 * 1024;
const MAX_DELIVERY_BYTES: usize = 8_000_000;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reference {
    kind: String, document_id: String, title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] grant_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] revision: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input { grant_id: String, item: Item, title: String, documents: Vec<Reference> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request { op: String, caller: String, handle: String, key: String, input: Input }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultRef { item: Item, delivery_id: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt { capability_id: String, payload_hash: String, result: ResultRef }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot { reference: Reference, document_date: String, content: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Provenance { #[serde(rename = "type")] source_type: String, capability_id: String, capability_version: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Delivery { id: String, title: String, created_at: String, provenance: Provenance, documents: Vec<Snapshot> }
fn hash(value: &impl Serialize) -> Result<String, String> { Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|e|e.to_string())?))) }
fn hex(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b|b.is_ascii_hexdigit()) }
fn item_valid(item: &Item) -> bool { !item.id.is_empty() && item.id.len() <= 256 && item.revision > 0 && item.revision <= crate::task_revisions::MAX_REVISION }
fn title_valid(title: &str) -> bool { !title.trim().is_empty() && title.chars().count() <= 120 }
fn reference_valid(reference: &Reference) -> bool {
    reference.kind == "library-document" && crate::document_library::validate_id(&reference.document_id).is_ok() && title_valid(&reference.title)
        && reference.revision.as_ref().is_none_or(|r| !r.is_empty() && r.len() <= 256)
        && reference.grant_id.as_ref().is_none_or(|id| !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') && reference.revision.is_some())
}
fn parse(value: Value) -> Result<Request, String> {
    let invalid = "INVALID_INPUT: invalid task delivery request";
    if !value.is_object() || !value["input"].is_object() || !value["input"]["item"].is_object()
        || serde_json::to_vec(&value).map_err(|e|e.to_string())?.len() > 65_536
        || value["input"]["documents"].as_array().is_none_or(|docs| docs.iter().any(|doc| !doc.is_object()
            || ["grantId","revision"].iter().any(|field| doc.get(field).is_some_and(|v| !v.is_string())))) { return Err(invalid.into()); }
    let request: Request = serde_json::from_value(value).map_err(|_|invalid)?;
    let mut ids = BTreeSet::new();
    if request.op != ATTACH || request.key.is_empty() || request.key.len() > 128 || request.key.chars().any(char::is_control)
        || !hex(&request.input.grant_id) || !item_valid(&request.input.item) || !title_valid(&request.input.title)
        || request.input.documents.is_empty() || request.input.documents.len() > 50
        || request.input.documents.iter().any(|doc| !reference_valid(doc) || !ids.insert(&doc.document_id)) { return Err(invalid.into()); }
    Ok(request)
}
pub(crate) fn validate_request(value: &Value) -> Result<(), String> { parse(value.clone()).map(|_| ()) }
fn receipts(board: &Value) -> Result<BTreeMap<String, Receipt>, String> {
    let Some(value) = board.get("attachmentReceipts") else { return Ok(BTreeMap::new()); };
    if value.as_object().is_none_or(|map| map.len() > MAX_RECEIPTS)
        || serde_json::to_vec(value).map_err(|e|e.to_string())?.len() > MAX_RECEIPT_BYTES { return Err("RESOURCE_LIMIT: attachment receipts exceed capacity".into()); }
    if value.as_object().unwrap().values().any(|r| !r.is_object() || !r["result"].is_object() || !r["result"]["item"].is_object()) { return Err("Invalid attachment receipt objects".into()); }
    let records: BTreeMap<String, Receipt> = serde_json::from_value(value.clone()).map_err(|_|"Invalid attachment receipts")?;
    let mut counts = BTreeMap::<&str, usize>::new(); let mut ids = BTreeSet::new();
    for (key, record) in &records {
        if !hex(key) || !hex(&record.payload_hash) || !hex(&record.result.delivery_id) || !item_valid(&record.result.item)
            || record.capability_id.is_empty() || record.capability_id.len() > 256 || !ids.insert(&record.result.delivery_id) { return Err("Invalid attachment receipt".into()); }
        let count = counts.entry(&record.capability_id).or_default(); *count += 1;
        if *count > MAX_PACKAGE_RECEIPTS { return Err("RESOURCE_LIMIT: package attachment receipt capacity exceeded".into()); }
    }
    Ok(records)
}
pub(crate) fn validate(board: &Value) -> Result<(), String> {
    receipts(board)?;
    let mut total = 0; let mut bytes = 0; let mut delivery_ids = BTreeSet::new();
    for card in board["cards"].as_array().ok_or("Invalid task board")? {
        let Some(value) = card.get("attachedDeliveries") else { continue; };
        let deliveries = value.as_array().ok_or("Invalid attached deliveries")?;
        total += deliveries.len(); bytes += serde_json::to_vec(value).map_err(|e|e.to_string())?.len();
        if deliveries.len() > 64 || total > 256 || bytes > MAX_DELIVERY_BYTES { return Err("RESOURCE_LIMIT: retained task deliveries exceed capacity".into()); }
        for value in deliveries {
            if !value.is_object() || !value["provenance"].is_object() || value["documents"].as_array().is_none_or(|docs| docs.iter().any(|d| !d.is_object() || !d["reference"].is_object())) { return Err("Invalid delivery objects".into()); }
            let delivery: Delivery = serde_json::from_value(value.clone()).map_err(|_|"Invalid attached delivery")?;
            let mut documents = BTreeSet::new();
            if !hex(&delivery.id) || !delivery_ids.insert(delivery.id.clone()) || !title_valid(&delivery.title)
                || chrono::DateTime::parse_from_rfc3339(&delivery.created_at).is_err() || delivery.provenance.source_type != "capability"
                || delivery.provenance.capability_id.is_empty() || delivery.provenance.capability_id.len() > 256
                || semver::Version::parse(&delivery.provenance.capability_version).is_err()
                || delivery.documents.is_empty() || delivery.documents.len() > 50
                || delivery.documents.iter().any(|doc| !reference_valid(&doc.reference) || doc.reference.revision.is_none()
                    || !documents.insert(&doc.reference.document_id) || chrono::NaiveDate::parse_from_str(&doc.document_date,"%Y-%m-%d").is_err()) { return Err("Invalid retained task delivery".into()); }
        }
    }
    Ok(())
}
fn capture(root: &Path, context: &InvocationContext, references: &[Reference]) -> Result<Vec<Snapshot>, String> {
    let selected = references.iter().filter(|r|r.grant_id.is_some()).map(|r| crate::document_grants::DocumentReference {
        kind:r.kind.clone(), document_id:r.document_id.clone(), title:r.title.clone(), grant_id:r.grant_id.clone().unwrap(), revision:r.revision.clone().unwrap(),
    }).collect::<Vec<_>>();
    let selected = crate::document_grants::task_documents(root, context, &selected)?;
    let mut captured = BTreeMap::new();
    let mut bytes = 0usize;
    let mut retain = |snapshot: Snapshot| -> Result<(), String> {
        bytes += serde_json::to_vec(&snapshot).map_err(|e|e.to_string())?.len();
        if bytes > MAX_DELIVERY_BYTES { return Err("RESOURCE_LIMIT: delivery snapshots exceed 8 MB".into()); }
        captured.insert(snapshot.reference.document_id.clone(), snapshot);
        Ok(())
    };
    for doc in selected {
        let reference: Reference = serde_json::from_value(json!(doc.reference)).map_err(|e|e.to_string())?;
        retain(Snapshot { reference,document_date:doc.document_date,content:doc.content.ok_or("RESOURCE_UNAVAILABLE: selected content missing")? })?;
    }
    if references.iter().any(|r| r.grant_id.is_none()) {
        if crate::capability_runtime::selection_context(root,&context.capability_id,CapabilityPermission::DocumentsPublish)? != *context {
            return Err("PERMISSION_DENIED: publication installation changed".into());
        }
        let _library = crate::library_management::DATA_LOCK.lock().map_err(|_|"Library unavailable")?;
        crate::library_management::organization(root)?;
        for reference in references.iter().filter(|r| r.grant_id.is_none()) {
            if reference.document_id.split('/').next() != Some(context.capability_id.as_str()) {
                return Err("PERMISSION_DENIED: delivery document belongs to another package".into());
            }
            let doc = crate::document_library::read_unlocked(root,&reference.document_id)?;
            if doc.capability_id != context.capability_id { return Err("PERMISSION_DENIED: delivery document belongs to another package".into()); }
            let revision = crate::document_library::revision(&doc);
            if doc.title != reference.title || reference.revision.as_ref().is_some_and(|expected| *expected != revision) {
                return Err("CONFLICT: delivery document changed".into());
            }
            let mut canonical = reference.clone(); canonical.revision = Some(revision);
            retain(Snapshot {reference:canonical,document_date:doc.document_date.clone(),content:doc.content})?;
        }
    }
    Ok(references.iter().map(|reference|captured.remove(&reference.document_id).unwrap()).collect())
}

// The worker holds task-data.lock; the invocation fence covers grant checking through the commit.
pub(crate) fn attach(root: &Path, board: &mut Value, value: Value) -> Result<Value, String> {
    let request = parse(value)?;
    crate::user_data::ensure_restore_complete(root)?;
    crate::capability_runtime::with_worker_board_authority(root,&request.caller,&request.handle,OPERATION,"board",|context| {
        let key = hash(&(&context.capability_id,OPERATION,&request.key))?;
        let payload_hash = hash(&request.input)?;
        let mut records = receipts(board)?;
        if let Some(receipt) = records.get(&key) {
            if receipt.payload_hash != payload_hash { return Err("CONFLICT: attachment key was used with different input".into()); }
            crate::task_goals::confirm_save(root)?;
            return serde_json::to_value(&receipt.result).map_err(|e|e.to_string());
        }
        if records.len() >= MAX_RECEIPTS || records.values().filter(|r| r.capability_id == context.capability_id).count() >= MAX_PACKAGE_RECEIPTS {
            return Err("RESOURCE_LIMIT: attachment receipts are full; existing receipts are retained".into());
        }
        crate::task_selection::authorize(root,board,context,&request.input.grant_id,&request.input.item,"attachDelivery")?;
        let _library_fence = crate::library_management::fence(root)?;
        let index = board["cards"].as_array().unwrap().iter().position(|c| c["id"] == request.input.item.id).unwrap();
        let documents = capture(root,context,&request.input.documents)?;
        let delivery_id = crate::capability_authority::nonce()?;
        if records.values().any(|record|record.result.delivery_id == delivery_id)
            || board["cards"].as_array().unwrap().iter().flat_map(|c|c["attachedDeliveries"].as_array().into_iter().flatten()).any(|d| d["id"] == delivery_id) {
            return Err("RESOURCE_UNAVAILABLE: delivery identity collision".into());
        }
        let result = ResultRef {item:Item { id:request.input.item.id, revision:crate::task_revisions::next(board)? },delivery_id:delivery_id.clone()};
        let delivery = Delivery {id:delivery_id,title:request.input.title,created_at:chrono::Local::now().to_rfc3339(),
            provenance:Provenance {source_type:"capability".into(),capability_id:context.capability_id.clone(),capability_version:context.capability_version.clone()},documents};
        if board["cards"][index].get("attachedDeliveries").is_none() { board["cards"][index]["attachedDeliveries"] = json!([]); }
        board["cards"][index]["attachedDeliveries"].as_array_mut().unwrap().push(serde_json::to_value(delivery).map_err(|e|e.to_string())?);
        records.insert(key,Receipt {capability_id:context.capability_id.clone(),payload_hash,result:result.clone()});
        board["attachmentReceipts"] = serde_json::to_value(records).map_err(|e|e.to_string())?;
        board["writeToken"] = json!(crate::capability_authority::nonce()?);
        crate::task_goals::save(root,board)?;
        serde_json::to_value(result).map_err(|e|e.to_string())
    })
}
