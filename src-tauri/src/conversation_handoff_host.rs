//! Main-view bindings for reviewed draft offers. No package receives conversation history.
use crate::{capability_runtime::PlatformState, conversation_handoff_selection as review,
    conversation_handoffs::{self as drafts,Target}, conversation_host::ConversationHost};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::collections::BTreeSet;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {handle:String,cursor:Option<String>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Read {id:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Sources {draft_id:String,snapshot_id:String,document_ids:Vec<String>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
fn request<T:serde::de::DeserializeOwned>(caller:&str,value:Value)->Result<T,String> {
    if caller!="main" {return Err("PERMISSION_DENIED: draft access requires the host".into());}
    if !value.is_object() || serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()>64*1024 {return Err("INVALID_INPUT: invalid draft request".into());}
    serde_json::from_value(value).map_err(|_|"INVALID_INPUT: invalid draft request".into())
}
async fn page(state:&PlatformState,bridge:&ConversationHost,cursor:Option<String>)->Result<Value,String> {
    let result=bridge.list(cursor,false).await.map_err(|_|"RESOURCE_UNAVAILABLE: conversation list unavailable")?;
    let entries=result["data"].as_array().ok_or("RESOURCE_UNAVAILABLE: invalid conversation list")?;
    let next=match &result["nextCursor"] {Value::Null=>None,Value::String(s) if !s.is_empty() && s.len()<=2048=>Some(s.clone()),_=>return Err("RESOURCE_UNAVAILABLE: invalid conversation cursor".into())};
    let task_threads=crate::task_goals::conversation_cards(state.data_dir())?;
    let mut data=Vec::new();let mut ids=BTreeSet::new();
    for thread in entries {
        let id=thread["id"].as_str().filter(|id|drafts::target_valid(&Target::Conversation{id:(*id).into()})).ok_or("RESOURCE_UNAVAILABLE: invalid conversation identity")?;
        if thread["archived"]==true || thread.get("taskId").is_some_and(|v|!v.is_null()) || task_threads.iter().any(|t|t["threadId"]==id) || !ids.insert(id) {continue;}
        let title=thread["name"].as_str().filter(|s|!s.trim().is_empty()).or_else(||thread["preview"].as_str().filter(|s|!s.trim().is_empty())).unwrap_or(id);
        data.push(json!({"id":id,"title":title.chars().take(120).collect::<String>()}));
    }
    Ok(json!({"data":data,"nextCursor":next,"partial":result.get("warning").is_some()}))
}
pub async fn targets(state:&PlatformState,bridge:&ConversationHost,caller:&str,value:Value)->Result<Value,String> {
    let input:Page=request(caller,value)?;
    if input.cursor.as_ref().is_some_and(|s|s.is_empty()||s.len()>2048) {return Err("INVALID_INPUT: invalid conversation cursor".into());}
    review::check_review(state,caller,&input.handle)?;
    let result=page(state,bridge,input.cursor).await?;
    review::check_review(state,caller,&input.handle)?;Ok(result)
}
async fn validate_target(state:&PlatformState,bridge:&ConversationHost,target:&Target)->Result<(),String> {
    let Target::Conversation{id}=target else {return Ok(())};
    if crate::task_goals::conversation_card(state.data_dir(),id)?.is_some() {return Err("PERMISSION_DENIED: task execution conversations are not handoff targets".into());}
    if bridge.owns(id)? {
        let view=bridge.read(id,None).await?;
        return if view["id"]==*id && view["archived"]!=true {Ok(())} else {Err("CONFLICT: conversation is no longer available".into())};
    }
    let mut cursor=None;let mut seen=BTreeSet::new();
    // Use the owner's active catalog, not unrelated thread/read or any package-supplied history.
    for _ in 0..128 {
        let result=page(state,bridge,cursor).await?;
        if result["data"].as_array().unwrap().iter().any(|t|t["id"]==*id) {return Ok(());}
        if result["partial"]==true {return Err("RESOURCE_UNAVAILABLE: conversation catalog is incomplete".into());}
        cursor=result["nextCursor"].as_str().map(String::from);
        let Some(next)=&cursor else {return Err("CONFLICT: conversation is no longer available".into())};
        if !seen.insert(next.clone()) {return Err("RESOURCE_UNAVAILABLE: conversation pagination did not advance".into());}
    }
    Err("RESOURCE_LIMIT: conversation target lookup exceeded its page budget".into())
}
pub async fn commit(state:&PlatformState,bridge:&ConversationHost,caller:&str,value:Value)->Result<Value,String> {
    let (target,replayed)=review::prepare_commit(state,caller,value.clone())?;
    if let Some(receipt)=replayed {return Ok(receipt);}
    let validation=validate_target(state,bridge,&target).await;
    review::commit(state,caller,value,|target| {
        validation?;
        if let Target::Conversation{id}=target {
            if crate::task_goals::conversation_card(state.data_dir(),id)?.is_some() {return Err("PERMISSION_DENIED: conversation became task-owned".into());}
        }
        Ok(())
    })
}
pub fn list(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    let _:Empty=request(caller,value)?;
    Ok(json!(drafts::list(state.data_dir())?.into_iter().map(|d|json!({"id":d.id,"title":d.title,"target":d.target,"capabilityId":d.capability_id,"capabilityVersion":d.capability_version,"createdAt":d.created_at})).collect::<Vec<_>>()))
}
pub fn read(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    let input:Read=request(caller,value)?;
    if input.id.len()!=64 || !input.id.bytes().all(|b|b.is_ascii_hexdigit()) {return Err("INVALID_INPUT: invalid draft identity".into());}
    serde_json::to_value(drafts::read(state.data_dir(),&input.id)?).map_err(|e|e.to_string())
}
pub fn sources(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    let input:Sources=request(caller,value)?;
    drafts::sources(state.data_dir(),&input.draft_id,&input.snapshot_id,&input.document_ids)
}
#[derive(Debug,Serialize)]
pub struct HandoffError {code:&'static str,message:&'static str}
impl HandoffError {
    fn from_native(error:&str,dispatched:bool)->Self {
        let (code,message)=match error.split_once(':').map(|(code,_)|code) {
            Some("INVALID_INPUT")=>("INVALID_INPUT","Invalid handoff request"),
            Some("PERMISSION_DENIED")=>("PERMISSION_DENIED","Handoff approval is missing or no longer valid"),
            Some("CONFLICT")=>("CONFLICT","The approved handoff or conversation changed"),
            Some("RESOURCE_LIMIT")=>("RESOURCE_LIMIT","Handoff capacity is exhausted"),
            Some("RESOURCE_BUSY")=>("RESOURCE_BUSY","The native owner is busy; retry unchanged"),
            Some("RESOURCE_UNAVAILABLE"|"NOT_FOUND")=>("RESOURCE_UNAVAILABLE","Conversation or draft unavailable"),
            Some("OUTCOME_UNKNOWN")=>("OUTCOME_UNKNOWN","The outcome is unknown; retry the same key and input"),
            _ if dispatched=>("OUTCOME_UNKNOWN","The outcome is unknown; retry the same key and input"),
            _=>("RESOURCE_UNAVAILABLE","Conversation or draft unavailable"),
        };Self{code,message}
    }
}
#[tauri::command]
pub fn conversation_handoff_begin(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>)->Result<Value,HandoffError> {
    review::begin(&state,webview.label(),request).map_err(|e|HandoffError::from_native(&e,false))
}
#[tauri::command]
pub fn conversation_handoff_cancel(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>)->Result<(),HandoffError> {
    review::cancel(&state,webview.label(),request).map_err(|e|HandoffError::from_native(&e,false))
}
#[tauri::command]
pub async fn conversation_handoff_targets(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,bridge:tauri::State<'_,ConversationHost>)->Result<Value,HandoffError> {
    targets(&state,&bridge,webview.label(),request).await.map_err(|e|HandoffError::from_native(&e,false))
}
#[tauri::command]
pub async fn conversation_handoff_commit(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,bridge:tauri::State<'_,ConversationHost>)->Result<Value,HandoffError> {
    commit(&state,&bridge,webview.label(),request).await.map_err(|e|HandoffError::from_native(&e,true))
}
#[tauri::command]
pub fn conversation_handoff_drafts(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>)->Result<Value,HandoffError> {
    list(&state,webview.label(),request).map_err(|e|HandoffError::from_native(&e,false))
}
#[tauri::command]
pub fn conversation_handoff_read(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>)->Result<Value,HandoffError> {
    read(&state,webview.label(),request).map_err(|e|HandoffError::from_native(&e,false))
}
#[tauri::command]
pub fn conversation_handoff_sources(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>)->Result<Value,HandoffError> {
    sources(&state,webview.label(),request).map_err(|e|HandoffError::from_native(&e,true))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binding_errors_preserve_uncertainty_without_leaking_native_details() {
        let raw="failed to write /private/synthetic/data.json";
        assert_eq!(serde_json::to_value(HandoffError::from_native(raw,true)).unwrap()["code"],"OUTCOME_UNKNOWN");
        assert_eq!(serde_json::to_value(HandoffError::from_native(raw,false)).unwrap()["code"],"RESOURCE_UNAVAILABLE");
        assert!(!serde_json::to_string(&HandoffError::from_native(raw,true)).unwrap().contains("/private"));
        assert_eq!(serde_json::to_value(HandoffError::from_native("CONFLICT: target changed",true)).unwrap()["code"],"CONFLICT");
    }
}
