//! Explicit Host approval creates independent native Goal work, never reparents a package run.
use crate::{capability_authority::InvocationContext, capability_runtime::{CapabilityPermission,PlatformState}, task_selection::Item};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,path::Path,time::{Duration,Instant}};

#[derive(Clone,Deserialize,Serialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Input { item:Item, grant_id:Option<String>, source_run_id:Option<String> }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Begin { request_id:String, capability_id:String, version:String, key:String, input:Input }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Handle { handle:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Cancel { request_id:String }
#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Receipt { capability_id:String, capability_version:String, approved_at:String, input:Input, receipt_id:String, task_id:String }
pub(crate) struct Review {
    context:InvocationContext, restore_id:Option<String>, request_id:String, key:String, input:Input,
    card:Value, documents:Vec<crate::source_snapshots::SnapshotDocument>, snapshot_id:String, expires:Instant,
}
fn hex(s:&str)->bool {s.len()==64 && s.bytes().all(|b|b.is_ascii_hexdigit())}
fn hash(value:&impl Serialize)->Result<String,String> {Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|e|e.to_string())?)))}
fn request<T:serde::de::DeserializeOwned>(caller:&str,value:Value)->Result<T,String> {
    if caller!="main" {return Err("PERMISSION_DENIED: independent execution requires Host review".into());}
    if !value.is_object() || serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()>4096 {return Err("INVALID_INPUT: invalid delegation request".into());}
    serde_json::from_value(value).map_err(|_|"INVALID_INPUT: invalid delegation request".into())
}
fn context(root:&Path,id:&str)->Result<InvocationContext,String> {
    crate::capability_runtime::selection_context(root,id,CapabilityPermission::BoardRequestDelegation)
}
fn records(board:&Value)->Result<BTreeMap<String,Receipt>,String> {
    let Some(value)=board.get("hostDelegations") else {return Ok(BTreeMap::new())};
    let records:BTreeMap<String,Receipt>=serde_json::from_value(value.clone()).map_err(|_|"Invalid Host delegation receipts")?;
    if records.len()>1024 || records.iter().any(|(key,r)|!hex(key)||!hex(&r.receipt_id)||r.capability_id.is_empty()||r.capability_id.len()>256||semver::Version::parse(&r.capability_version).is_err()||chrono::DateTime::parse_from_rfc3339(&r.approved_at).is_err()||r.task_id!=r.input.item.id||!input_valid(&r.input)) {
        return Err("Invalid Host delegation receipts".into());
    }
    Ok(records)
}
fn input_valid(input:&Input)->bool {
    !input.item.id.is_empty() && input.item.id.len()<=100 && input.item.id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')
        && input.item.revision>0 && input.item.revision<=crate::task_revisions::MAX_REVISION
        && input.grant_id.as_ref().is_none_or(|s|hex(s)) && input.source_run_id.as_ref().is_none_or(|s|hex(s))
}
pub(crate) fn validate(board:&Value)->Result<(),String> {
    records(board)?;
    for card in board["cards"].as_array().ok_or("Invalid task board")? {
        if let Some(ids)=card["authorization"].get("deliveryIds") {
            let ids=ids.as_array().filter(|ids|ids.len()<=64).ok_or("Invalid delegated deliveries")?;
            if ids.iter().any(|id|id.as_str().is_none_or(|s|!hex(s))) {return Err("Invalid delegated delivery identity".into());}
        }
    }
    Ok(())
}
fn receipt(record:&Receipt)->Value {json!({"receiptId":record.receipt_id,"taskId":record.task_id,"engine":"codex"})}
fn lookup(board:&Value,review:&Review)->Result<Option<Value>,String> {
    let key=hash(&(&review.context.capability_id,&review.key))?;
    if let Some(record)=records(board)?.get(&key) {
        if record.input!=review.input {return Err("CONFLICT: delegation key was used with different input".into());}
        return Ok(Some(receipt(record)));
    }
    Ok(None)
}
fn current(root:&Path,review:&Review)->Result<(),String> {
    if context(root,&review.context.capability_id)?!=review.context || crate::user_data::restored_id(root)?!=review.restore_id {
        return Err("PERMISSION_DENIED: delegation installation or restore scope changed".into());
    }
    Ok(())
}
fn target<'a>(root:&Path,board:&'a Value,review:&Review)->Result<&'a Value,String> {
    let card=board["cards"].as_array().unwrap().iter().find(|c|c["id"]==review.input.item.id && c["revision"]==review.input.item.revision)
        .ok_or("CONFLICT: task changed; review it again")?;
    if card["status"]!="todo" || card["engine"]=="goals" || card["archived"]==true || card.get("authorization").is_some() || card["runId"].is_string() || card["threadId"].is_string() {return Err("CONFLICT: only an unstarted todo can be delegated".into());}
    if card["provenance"]["type"]!="capability" || card["provenance"]["capabilityId"]!=review.context.capability_id {
        crate::task_selection::authorize(root,board,&review.context,review.input.grant_id.as_deref().ok_or("PERMISSION_DENIED: select this task first")?,&review.input.item,"attachDelivery")?;
    }
    if let Some(id)=&review.input.source_run_id {
        let scope=crate::capability_agent_runs::Scope {installation:review.context.clone(),restore_id:review.restore_id.clone()};
        if !crate::capability_agent_runs::completed_for_handoff(root,&scope,id)? {return Err("CONFLICT: resolve the original Agent run before delegating its work".into());}
    }
    Ok(card)
}
fn metadata(handle:&str,r:&Review)->Value {json!({"status":"pending","handle":handle,"requestId":r.request_id,"capabilityId":r.context.capability_id,"version":r.context.capability_version})}
pub fn begin(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    let input:Begin=request(caller,value)?;
    if input.request_id.is_empty()||input.request_id.len()>100||!input.request_id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')
        ||input.key.is_empty()||input.key.len()>128||input.key.chars().any(char::is_control)||!input_valid(&input.input) {return Err("INVALID_INPUT: invalid delegation identity".into());}
    state.prepare_selection_grant(&input.capability_id,CapabilityPermission::BoardRequestDelegation)?;
    let mut pending=state.delegation_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: delegation reviews unavailable")?;
    pending.retain(|_,r|r.expires>Instant::now());
    let root=state.data_dir();let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;let _authority=crate::capability_authority::fence(root)?;
    let context=context(root,&input.capability_id)?;
    if context.capability_version!=input.version {return Err("PERMISSION_DENIED: delegation version changed".into());}
    let mut review=Review {context,restore_id:crate::user_data::restored_id(root)?,request_id:input.request_id,key:input.key,input:input.input,card:Value::Null,documents:Vec::new(),snapshot_id:crate::capability_authority::nonce()?,expires:Instant::now()+Duration::from_secs(900)};
    let board=crate::task_goals::load(root)?;
    if let Some(saved)=lookup(&board,&review)? {crate::task_goals::confirm_save(root)?;return Ok(json!({"status":"committed","receipt":saved}));}
    if let Some((handle,old))=pending.iter().find(|(_,r)|r.request_id==review.request_id) {
        if old.context!=review.context||old.restore_id!=review.restore_id||old.input!=review.input||old.key!=review.key {return Err("CONFLICT: delegation review identity changed".into());}
        return Ok(metadata(handle,old));
    }
    if pending.len()>=16 {return Err("RESOURCE_LIMIT: close an existing delegation review".into());}
    review.card=target(root,&board,&review)?.clone();
    // Capture before displaying the review so confirmation and execution use the same source text.
    review.documents=crate::source_snapshots::prepare_task_review(root,&review.snapshot_id,review.card.get("sources").unwrap_or(&json!([])))?;
    let handle=crate::capability_authority::nonce()?;let result=metadata(&handle,&review);pending.insert(handle,review);Ok(result)
}
pub fn inspect(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    let input:Handle=request(caller,value)?;
    let pending=state.delegation_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: delegation reviews unavailable")?;
    let review=pending.get(&input.handle).filter(|r|r.expires>Instant::now()).ok_or("PERMISSION_DENIED: delegation review expired")?;
    let root=state.data_dir();let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;let _authority=crate::capability_authority::fence(root)?;current(root,review)?;
    Ok(json!({"title":review.card["title"],"description":format!("{}{}",review.card["description"].as_str().unwrap_or_default(),review.card["feedback"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|s|format!("\n\n{s}")).collect::<String>()),"documents":review.documents,"deliveries":review.card.get("attachedDeliveries").cloned().unwrap_or(json!([]))}))
}
pub fn commit(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    let input:Handle=request(caller,value)?;
    let pending=state.delegation_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: delegation reviews unavailable")?;
    let review=pending.get(&input.handle).filter(|r|r.expires>Instant::now()).ok_or("PERMISSION_DENIED: delegation review expired or dismissed")?;
    let root=state.data_dir();let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: task data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;let _authority=crate::capability_authority::fence(root)?;current(root,review)?;
    let mut board=crate::task_goals::load(root)?;
    if let Some(saved)=lookup(&board,review)? {crate::task_goals::confirm_save(root)?;return Ok(saved);}
    target(root,&board,review)?;
    let mut records=records(&board)?;
    if records.len()>=1024 {return Err("RESOURCE_LIMIT: delegation receipt capacity exhausted".into());}
    crate::source_snapshots::save_task_review(root,&review.snapshot_id,&review.documents)?;
    let record=Receipt {capability_id:review.context.capability_id.clone(),capability_version:review.context.capability_version.clone(),approved_at:chrono::Utc::now().to_rfc3339(),input:review.input.clone(),receipt_id:review.snapshot_id.clone(),task_id:review.input.item.id.clone()};
    let queued_at=board["cards"].as_array().unwrap().iter().filter_map(|c|c["queuedAt"].as_u64()).max().unwrap_or(0).saturating_add(1).max(chrono::Utc::now().timestamp_millis() as u64);
    let card=board["cards"].as_array_mut().unwrap().iter_mut().find(|c|c["id"]==review.input.item.id).unwrap();
    card["engine"]=json!("goals");card["cwd"]=json!("");card["status"]=json!("queued");card["queuedAt"]=json!(queued_at);
    card["authorization"]=json!({"snapshotId":review.snapshot_id,"receiptId":record.receipt_id,
        "documentIds":review.card["sources"].as_array().into_iter().flatten().map(|s|s["id"].clone()).collect::<Vec<_>>(),
        "deliveryIds":review.card["attachedDeliveries"].as_array().into_iter().flatten().map(|d|d["id"].clone()).collect::<Vec<_>>()});
    for field in ["runId","error","execution","threadId","activeTurn","intent","goal","requests","restored"] {card.as_object_mut().unwrap().remove(field);}
    let result=receipt(&record);records.insert(hash(&(&review.context.capability_id,&review.key))?,record);
    board["hostDelegations"]=serde_json::to_value(records).map_err(|e|e.to_string())?;
    board["writeToken"]=json!(crate::capability_authority::nonce()?);
    crate::task_goals::save(root,&mut board)?;Ok(result)
}
pub fn cancel(state:&PlatformState,caller:&str,value:Value)->Result<(),String> {
    let input:Cancel=request(caller,value)?;
    state.delegation_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: delegation reviews unavailable")?.retain(|_,r|r.request_id!=input.request_id);Ok(())
}
#[cfg(test)]
#[path="capability_delegation_tests.rs"]
mod tests;
