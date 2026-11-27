//! Native Host review/controller for trusted legacy UI. No IPC endpoint or adapter dispatch here.
//! Policy resolution is supplied by a native adapter owner, never by the package request.
use crate::{capability_agent_runs::{self as runs, Intent, Scope, ResolvedPolicy}, capability_runtime::{CapabilityPermission, PlatformState},
    document_grants::DocumentReference};
use serde::Deserialize;
use serde_json::{json,Value};
use std::{path::Path,time::{Duration,Instant}};

#[derive(Clone,PartialEq,Eq,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Proposal {instructions:String,sources:Vec<DocumentReference>,agent_id:String,output_schema:Option<Value>}
impl Proposal {
    fn bind(&self,policy:ResolvedPolicy)->Intent {Intent {instructions:self.instructions.clone(),sources:self.sources.clone(),
        agent_id:self.agent_id.clone(),output_schema:self.output_schema.clone(),policy_digest:policy.digest,component:Some(policy.component)}}
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Begin {request_id:String,capability_id:String,version:String,key:String,proposal:Proposal}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Approval {handle:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Cancel {request_id:String}
pub(crate) struct Review {scope:Scope,request_id:String,key:String,intent:Intent,expires_at:Instant}
fn host(caller:&str)->Result<(),String> {
    if caller!="main" {return Err("PERMISSION_DENIED: Agent execution requires the Host controller".into());} Ok(())
}
fn request<T:serde::de::DeserializeOwned>(caller:&str,value:Value)->Result<T,String> {
    host(caller)?;
    if !value.is_object() || serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()>65_536 {
        return Err("INVALID_INPUT: invalid Agent review envelope".into());
    }
    serde_json::from_value(value).map_err(|_|"INVALID_INPUT: invalid Agent review request".into())
}
fn correlation(id:&str)->bool {!id.is_empty() && id.len()<=100 && id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')}
fn context(root:&Path,id:&str)->Result<crate::capability_authority::InvocationContext,String> {
    crate::capability_runtime::selection_context(root,id,CapabilityPermission::AgentsRun)
}
pub(crate) fn current(root:&Path,scope:&Scope)->Result<(),String> {
    if context(root,&scope.installation.capability_id)?!=scope.installation || crate::user_data::restored_id(root)?!=scope.restore_id {
        return Err("PERMISSION_DENIED: Agent installation or restore scope changed".into());
    } Ok(())
}
fn policy_current(intent:&Intent,resolve:impl FnOnce(&str)->Result<ResolvedPolicy,String>)->Result<(),String> {
    let policy=resolve(&intent.agent_id)?;
    if policy.digest!=intent.policy_digest || Some(policy.component)!=intent.component {return Err("PERMISSION_DENIED: Agent execution policy changed; review a new intent".into());} Ok(())
}
pub(crate) fn metadata(run:&runs::Run)->Value {json!({"status":if run.restored {"retained"} else {"approved"},"runId":run.id,"submission":run.submission,"restored":run.restored,"outcome":run.outcome})}
/// Public projection contains no native/session, approval, policy, or submission identifiers.
pub(crate) fn snapshot(run:&runs::Run)->Value {
    let (status,result)=match &run.outcome {
        Some(runs::Outcome::Completed{text})=>("completed",json!({"text":text})),
        Some(runs::Outcome::Failed)=>("failed",Value::Null),
        Some(runs::Outcome::Cancelled)=>("cancelled",Value::Null),
        None if run.submission==runs::Submission::Approved=>("approved",Value::Null),
        None if run.native.as_ref().and_then(|native|native.turn_id.as_ref()).is_some()=>("running",Value::Null),
        None=>("unknown",Value::Null),
    };
    json!({"id":run.id,"agentId":run.intent.agent_id,"status":status,"restored":run.restored,"result":result})
}
pub(crate) fn public_get(state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<Value,String> {
    host(caller)?;let scope=scope(state,id,version)?;let root=state.data_dir();
    Ok(snapshot(&runs::get(root,&scope,run_id,||current(root,&scope))?))
}
fn pending(handle:&str,review:&Review)->Value {
    json!({"status":"pending","handle":handle,"requestId":review.request_id,"capabilityId":review.scope.installation.capability_id,
        "version":review.scope.installation.capability_version,"intent":review.intent})
}
/// `resolve_policy` checks adapter availability and returns the component identity and digest of its complete, bounded
/// execution configuration. It is synchronous native policy lookup, not IPC or package code.
pub fn begin(state:&PlatformState,caller:&str,value:Value,resolve_policy:impl FnOnce(&str)->Result<ResolvedPolicy,String>)->Result<Value,String> {
    let input:Begin=request(caller,value)?;
    if !correlation(&input.request_id) || input.key.trim().is_empty() || input.key.len()>128 || input.key.chars().any(char::is_control)
        || !runs::intent_valid(&input.proposal.bind(ResolvedPolicy {digest:"0".repeat(64),component:runs::ComponentIdentity {protocol_revision:1,sha256:"0".repeat(64)}})) {return Err("INVALID_INPUT: invalid Agent proposal".into());}
    if input.proposal.agent_id!="codex" {return Err("UNSUPPORTED_SERVICE: this Agent has no verified capability execution policy".into());}
    state.prepare_selection_grant(&input.capability_id,CapabilityPermission::AgentsRun)?;
    let root=state.data_dir();
    let mut reviews=state.agent_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: Agent reviews unavailable")?;
    reviews.retain(|_,review|review.expires_at>Instant::now());
    let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    let _authority=crate::capability_authority::fence(root)?;
    let installation=context(root,&input.capability_id)?;
    if installation.capability_version!=input.version {return Err("PERMISSION_DENIED: Agent installation changed".into());}
    let scope=Scope {installation,restore_id:crate::user_data::restored_id(root)?};
    let intent=input.proposal.bind(resolve_policy(&input.proposal.agent_id)?);
    if !runs::intent_valid(&intent) {return Err("UNSUPPORTED_SERVICE: native Agent policy is unavailable".into());}
    if reviews.values().any(|r|r.request_id==input.request_id && (r.scope!=scope || r.key!=input.key || r.intent!=intent)) {
        return Err("CONFLICT: Agent review identity changed".into());
    }
    if let Some(run)=runs::lookup(root,&scope,&input.key)? {
        if run.intent!=intent {return Err("CONFLICT: Agent run key was used with different intent".into());}
        return Ok(metadata(&run));
    }
    // Reject foreign/revoked selection references before showing a review, then recheck at approval
    // and submission. The retained grant snapshot, not the current Library body, defines the input.
    crate::document_grants::task_documents(root,&scope.installation,&intent.sources)?;
    if let Some((handle,review))=reviews.iter().find(|(_,r)|r.request_id==input.request_id) {return Ok(pending(handle,review));}
    if reviews.len()>=16 {return Err("RESOURCE_LIMIT: close an existing Agent review".into());}
    let handle=crate::capability_authority::nonce()?;
    if reviews.contains_key(&handle) {return Err("RESOURCE_UNAVAILABLE: Agent review identity collision".into());}
    let review=Review {scope,request_id:input.request_id,key:input.key,intent,expires_at:Instant::now()+Duration::from_secs(15*60)};
    let result=pending(&handle,&review);reviews.insert(handle,review);Ok(result)
}
pub fn approve(state:&PlatformState,caller:&str,value:Value,resolve_policy:impl FnOnce(&str)->Result<ResolvedPolicy,String>)->Result<Value,String> {
    let input:Approval=request(caller,value)?;
    let reviews=state.agent_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: Agent reviews unavailable")?;
    let review=reviews.get(&input.handle).filter(|r|r.expires_at>Instant::now()).ok_or("PERMISSION_DENIED: Agent review expired or was dismissed")?;
    let root=state.data_dir();
    let run=runs::approve(root,&review.scope,&review.key,&review.intent,|| {
        current(root,&review.scope)?;policy_current(&review.intent,resolve_policy)?;
        if review.expires_at<=Instant::now() {return Err("PERMISSION_DENIED: Agent review expired before authorization".into());} Ok(())
    },|| crate::document_grants::task_documents(root,&review.scope.installation,&review.intent.sources))?;
    Ok(metadata(&run))
}
pub fn cancel(state:&PlatformState,caller:&str,value:Value)->Result<(),String> {
    let input:Cancel=request(caller,value)?;
    if !correlation(&input.request_id) {return Err("INVALID_INPUT: invalid Agent review identity".into());}
    state.agent_reviews.lock().map_err(|_|"RESOURCE_UNAVAILABLE: Agent reviews unavailable")?.retain(|_,r|r.request_id!=input.request_id);Ok(())
}
pub(crate) fn scope(state:&PlatformState,id:&str,version:&str)->Result<Scope,String> {
    let root=state.data_dir();let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;let _authority=crate::capability_authority::fence(root)?;
    let installation=context(root,id)?;
    if installation.capability_version!=version {return Err("PERMISSION_DENIED: Agent installation changed".into());}
    Ok(Scope {installation,restore_id:crate::user_data::restored_id(root)?})
}
/// Observation returns metadata only. It neither starts work nor rechecks whether a once-used
/// source remains selected. Installation authority must still be current.
pub fn get(state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<Value,String> {
    host(caller)?;let scope=scope(state,id,version)?;let root=state.data_dir();
    Ok(metadata(&runs::get(root,&scope,run_id,||current(root,&scope))?))
}
/// Adapter owner only: the returned run is the first durable submission claim, not a public SDK
/// result. C06c must verify the component bytes/protocol before native startup, reconcile uncertain
/// submissions and enforce the same resolved native policy.
pub fn claim(state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str,
    resolve_policy:impl FnOnce(&str)->Result<ResolvedPolicy,String>)->Result<runs::Run,String> {
    host(caller)?;let scope=scope(state,id,version)?;let root=state.data_dir();
    runs::claim_submission(root,&scope,run_id,|run| {
        current(root,&scope)?;
        // Revocation cannot turn an uncertain external outcome into a fresh retryable failure.
        // Only a new submission needs effect-time policy/source checks; the journal refuses repeats.
        if run.restored || run.submission!=runs::Submission::Approved {return Ok(());}
        policy_current(&run.intent,resolve_policy)?;
        crate::document_grants::task_documents(root,&scope.installation,&run.intent.sources)?;Ok(())
    })
}

/// Trusted adapter observation only: correlate actual native provenance with the retained claim.
/// No package/renderer endpoint exposes these operations, and neither starts/resumes a turn.
pub fn native_binding(state:&PlatformState,id:&str,version:&str,run_id:&str)->Result<runs::NativeRunBinding,String> {
    let scope=scope(state,id,version)?;let root=state.data_dir();
    runs::native_binding(root,&scope,run_id,||current(root,&scope))
}
pub fn record_native(state:&PlatformState,id:&str,version:&str,binding:&runs::NativeRunBinding,
    observed:&runs::NativeIdentity)->Result<runs::Run,String> {
    let scope=scope(state,id,version)?;let root=state.data_dir();
    runs::record_native(root,&scope,binding,observed,||current(root,&scope))
}

#[cfg(test)]
#[path="capability_agent_review_tests.rs"]
mod tests;
