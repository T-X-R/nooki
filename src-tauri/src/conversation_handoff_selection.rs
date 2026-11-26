//! Host-owned handoff review for trusted legacy UI. A proposal supplies no conversation authority.
use crate::{capability_authority::InvocationContext, capability_runtime::{CapabilityPermission, PlatformState},
    conversation_handoffs::{self as drafts, ApprovedDraft, Target}, document_grants::DocumentReference};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::Path, time::{Duration, Instant}};

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Proposal { title:String,text:String,sources:Vec<DocumentReference> }
impl Proposal {
    fn bind(&self,target:Target)->ApprovedDraft { ApprovedDraft {title:self.title.clone(),text:self.text.clone(),sources:self.sources.clone(),target} }
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Begin { request_id:String,capability_id:String,version:String,key:String,draft:Proposal }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Commit {handle:String,target:Target}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Cancel {request_id:String}
pub(crate) struct Selection {
    context:InvocationContext,restore_id:Option<String>,request_id:String,key:String,
    draft:Proposal,approved:Option<Target>,expires_at:Instant,
}
fn request<T:serde::de::DeserializeOwned>(caller:&str,value:Value)->Result<T,String> {
    if caller!="main" {return Err("PERMISSION_DENIED: handoff requires the host review controller".into());}
    if !value.is_object() || serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()>65_536 {
        return Err("INVALID_INPUT: invalid handoff envelope".into());
    }
    serde_json::from_value(value).map_err(|_|"INVALID_INPUT: invalid handoff request".into())
}
fn correlation_valid(id:&str)->bool { !id.is_empty() && id.len()<=100 && id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-') }
fn context(root:&Path,id:&str)->Result<InvocationContext,String> {
    crate::capability_runtime::selection_context(root,id,CapabilityPermission::ConversationsHandoff)
}
fn metadata(handle:&str,selection:&Selection)->Value {
    json!({"status":"pending","handle":handle,"requestId":selection.request_id,"capabilityId":selection.context.capability_id,"version":selection.context.capability_version})
}
pub fn begin(state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
    if !value["draft"].is_object() || value["draft"]["sources"].as_array().is_none_or(|sources| sources.iter().any(|source|
        source.as_object().is_none_or(|fields| fields.len()!=5 || fields.keys().any(|k|!["kind","documentId","title","grantId","revision"].contains(&k.as_str()))))) {
        return Err("INVALID_INPUT: invalid handoff proposal".into());
    }
    let input:Begin=request(caller,value)?;
    if !correlation_valid(&input.request_id) || input.key.is_empty() || input.key.len()>128 || input.key.chars().any(char::is_control)
        || !drafts::input_valid(&input.draft.bind(Target::New)) {return Err("INVALID_INPUT: invalid handoff content or identity".into());}
    state.prepare_selection_grant(&input.capability_id,CapabilityPermission::ConversationsHandoff)?;
    let root=state.data_dir();
    // Match commit's pending -> data -> authority order, including committed-receipt lookup.
    let mut pending=state.handoff_selections.lock().map_err(|_|"RESOURCE_UNAVAILABLE: handoff reviews unavailable")?;
    pending.retain(|_,s|s.expires_at>Instant::now());
    let (context,restore_id)={
        let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing")?;
        crate::user_data::ensure_restore_complete(root)?;
        let _authority=crate::capability_authority::fence(root)?;
        let context=context(root,&input.capability_id)?;
        if context.capability_version!=input.version {return Err("PERMISSION_DENIED: handoff installation changed".into());}
        let restore_id=crate::user_data::restored_id(root)?;
        if pending.values().any(|s|s.request_id==input.request_id && (s.context!=context || s.restore_id!=restore_id || s.key!=input.key || s.draft!=input.draft)) {
            return Err("CONFLICT: handoff review identity changed".into());
        }
        if let Some((approved,receipt))=drafts::lookup(root,&input.capability_id,&input.key)? {
            if input.draft.bind(approved.target.clone())!=approved {return Err("CONFLICT: handoff key was used with different input".into());}
            return Ok(json!({"status":"committed","receipt":receipt}));
        }
        (context,restore_id)
    };
    if let Some((handle,selection))=pending.iter().find(|(_,s)|s.request_id==input.request_id) {
        return Ok(metadata(handle,selection));
    }
    if pending.len()>=16 {return Err("RESOURCE_LIMIT: close an existing handoff review".into());}
    let handle=crate::capability_authority::nonce()?;
    if pending.contains_key(&handle) {return Err("RESOURCE_UNAVAILABLE: handoff identity collision".into());}
    let selection=Selection {context,restore_id,request_id:input.request_id,key:input.key,draft:input.draft,approved:None,expires_at:Instant::now()+Duration::from_secs(15*60)};
    let result=metadata(&handle,&selection);pending.insert(handle,selection);Ok(result)
}
/// The native conversation owner validates the selected target only for a new effect. A recorded
/// receipt is not a new navigation or send grant. C05b2 supplies real target discovery/validation.
pub fn commit(state:&PlatformState,caller:&str,value:Value,validate_target:impl FnOnce(&Target)->Result<(),String>)->Result<Value,String> {
    if !value["target"].is_object() {return Err("INVALID_INPUT: invalid handoff target".into());}
    let input:Commit=request(caller,value)?;
    if !drafts::target_valid(&input.target) {return Err("INVALID_INPUT: invalid handoff target".into());}
    let mut pending=state.handoff_selections.lock().map_err(|_|"RESOURCE_UNAVAILABLE: handoff reviews unavailable")?;
    pending.retain(|_,s|s.expires_at>Instant::now());
    let selection=pending.get_mut(&input.handle).ok_or("PERMISSION_DENIED: handoff review expired or was dismissed")?;
    if selection.approved.as_ref().is_some_and(|target|target!=&input.target) {return Err("CONFLICT: approved handoff target changed".into());}
    selection.approved=Some(input.target.clone()); // Freeze even when source/target validation or durable write fails.
    let approved=selection.draft.bind(input.target);
    let root=state.data_dir();
    let receipt=drafts::commit_approved(root,&selection.context.capability_id,&selection.context.capability_version,&selection.key,&approved,
        || {
            if context(root,&selection.context.capability_id)?!=selection.context || crate::user_data::restored_id(root)?!=selection.restore_id {
                return Err("PERMISSION_DENIED: handoff installation or restore scope changed".into());
            }
            Ok(())
        },
        || {validate_target(&approved.target)?;crate::document_grants::task_documents(root,&selection.context,&approved.sources)})?;
    serde_json::to_value(receipt).map_err(|e|e.to_string())
}
pub fn cancel(state:&PlatformState,caller:&str,value:Value)->Result<(),String> {
    let input:Cancel=request(caller,value)?;
    if !correlation_valid(&input.request_id) {return Err("INVALID_INPUT: invalid handoff review identity".into());}
    state.handoff_selections.lock().map_err(|_|"RESOURCE_UNAVAILABLE: handoff reviews unavailable")?.retain(|_,s|s.request_id!=input.request_id);Ok(())
}
#[cfg(test)]
#[path = "conversation_handoff_selection_tests.rs"]
mod tests;
