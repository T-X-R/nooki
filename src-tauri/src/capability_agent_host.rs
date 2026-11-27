//! Main-window Agent bindings. Packages receive public snapshots, never native RPC access.
use crate::{capability_agent_execution::Executor,capability_agent_review as review,capability_runtime::PlatformState};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};

/// No ordinary Codex fallback. Product setup installs only a qualified component owner here.
#[derive(Default)]
pub(crate) struct AgentHost {pub executor:Option<Executor>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Invocation {capability_id:String,version:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct RunRequest {capability_id:String,version:String,run_id:String}
fn request<T:serde::de::DeserializeOwned>(caller:&str,value:Value)->Result<T,String> {
    if caller!="main" {return Err("PERMISSION_DENIED: Agent access requires the Host".into());}
    if !value.is_object() || serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()>65_536 {
        return Err("INVALID_INPUT: invalid Agent request".into());
    }
    serde_json::from_value(value).map_err(|_|"INVALID_INPUT: invalid Agent request".into())
}
impl AgentHost {
    fn owner(&self)->Result<&Executor,String> {self.executor.as_ref().ok_or_else(||"UNSUPPORTED_SERVICE: capability Codex component is unavailable".into())}
    pub(crate) fn available(&self,state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
        let input:Invocation=request(caller,value)?;review::scope(state,&input.capability_id,&input.version)?;
        Ok(if self.owner().and_then(|owner|owner.policy("codex")).is_ok(){json!([{"id":"codex","name":"Codex"}])}else{json!([])})
    }
    pub(crate) fn begin(&self,state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
        let input:Value=request(caller,value.clone())?;
        let result=review::begin(state,caller,value,|agent|self.owner()?.policy(agent))?;
        if result["status"]=="pending" {
            return Ok(json!({"status":"pending","handle":result["handle"],"requestId":result["requestId"],
                "capabilityId":result["capabilityId"],"version":result["version"]}));
        }
        let run=review::public_get(state,caller,input["capabilityId"].as_str().unwrap_or(""),input["version"].as_str().unwrap_or(""),result["runId"].as_str().unwrap_or(""))?;
        Ok(json!({"status":"existing","run":run}))
    }
    pub(crate) fn approve(&self,state:&PlatformState,caller:&str,value:Value)->Result<Value,String> {
        // Approval returns only the opaque run reference. Execution revalidates its installation.
        let result=review::approve(state,caller,value,|agent|self.owner()?.policy(agent))?;
        Ok(json!({"id":result["runId"]}))
    }
    pub(crate) async fn run(&self,state:&PlatformState,caller:&str,value:Value,operation:&str)->Result<Value,String> {
        let input:RunRequest=request(caller,value)?;
        // Observation of retained terminal history works without an installed component.
        let prior=review::public_get(state,caller,&input.capability_id,&input.version,&input.run_id)?;
        if operation=="get" && (prior["restored"]==true || prior["status"]=="approved" || !prior["result"].is_null() || prior["status"]=="failed" || prior["status"]=="cancelled") {return Ok(prior);}
        if prior["restored"]==true {return Err("PERMISSION_DENIED: restored history cannot control execution".into());}
        #[cfg(unix)] {
            let owner=self.owner()?;
            match operation {
                "start"=>owner.start(state,caller,&input.capability_id,&input.version,&input.run_id).await?,
                "cancel"=>owner.cancel(state,caller,&input.capability_id,&input.version,&input.run_id).await?,
                _=>owner.observe(state,caller,&input.capability_id,&input.version,&input.run_id).await?,
            };
            review::public_get(state,caller,&input.capability_id,&input.version,&input.run_id)
        }
        #[cfg(not(unix))] {Err("UNSUPPORTED_SERVICE: capability Codex is unavailable on this platform".into())}
    }
}
#[derive(Debug,Serialize)]
pub struct AgentError {code:&'static str,message:&'static str}
impl AgentError {
    fn native(error:String,effect:bool)->Self {
        let (code,message)=match error.split_once(':').map(|(code,_)|code) {
            Some("INVALID_INPUT")=>("INVALID_INPUT","Invalid Agent request"),
            Some("PERMISSION_DENIED")=>("PERMISSION_DENIED","Agent or source access is missing or no longer valid"),
            Some("UNSUPPORTED_SERVICE")=>("UNSUPPORTED_SERVICE","Capability Codex execution is not available"),
            Some("CONFLICT")=>("CONFLICT","The approved Agent request changed or cannot perform this operation"),
            Some("RESOURCE_LIMIT")=>("RESOURCE_LIMIT","Agent capacity is exhausted"),
            Some("RESOURCE_BUSY")=>("RESOURCE_BUSY","The Agent owner is busy; retry unchanged"),
            Some("OUTCOME_UNKNOWN")=>("OUTCOME_UNKNOWN","Observe this run or retry the same key and input; do not create another run"),
            _ if effect=>("OUTCOME_UNKNOWN","Observe this run or retry the same key and input; do not create another run"),
            _=>("RESOURCE_UNAVAILABLE","Agent status is temporarily unavailable"),
        };Self{code,message}
    }
}
#[tauri::command]
pub(crate) fn capability_agent_available(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,agents:tauri::State<'_,AgentHost>)->Result<Value,AgentError> {
    agents.available(&state,webview.label(),request).map_err(|e|AgentError::native(e,false))
}
#[tauri::command]
pub(crate) fn capability_agent_begin(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,agents:tauri::State<'_,AgentHost>)->Result<Value,AgentError> {
    agents.begin(&state,webview.label(),request).map_err(|e|AgentError::native(e,false))
}
#[tauri::command]
pub(crate) fn capability_agent_approve(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,agents:tauri::State<'_,AgentHost>)->Result<Value,AgentError> {
    agents.approve(&state,webview.label(),request).map_err(|e|AgentError::native(e,true))
}
#[tauri::command]
pub(crate) fn capability_agent_dismiss(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>)->Result<(),AgentError> {
    review::cancel(&state,webview.label(),request).map_err(|e|AgentError::native(e,false))
}
#[tauri::command]
pub(crate) async fn capability_agent_start(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,agents:tauri::State<'_,AgentHost>)->Result<Value,AgentError> {
    agents.run(&state,webview.label(),request,"start").await.map_err(|e|AgentError::native(e,true))
}
#[tauri::command]
pub(crate) async fn capability_agent_get(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,agents:tauri::State<'_,AgentHost>)->Result<Value,AgentError> {
    agents.run(&state,webview.label(),request,"get").await.map_err(|e|AgentError::native(e,false))
}
#[tauri::command]
pub(crate) async fn capability_agent_cancel(webview:tauri::Webview,request:Value,state:tauri::State<'_,PlatformState>,agents:tauri::State<'_,AgentHost>)->Result<Value,AgentError> {
    agents.run(&state,webview.label(),request,"cancel").await.map_err(|e|AgentError::native(e,true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{capability_agent_runs as runs,capability_runtime::CapabilityManifest};
    use std::fs;
    #[tokio::test]
    async fn unavailable_component_never_falls_back_and_retained_results_are_scoped() {
        let root=std::env::temp_dir().join(format!("nooki-agent-host-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        for id in ["example.meeting","example.peer"] {
            let manifest:CapabilityManifest=serde_json::from_value(json!({"id":id,"name":"Meeting","version":"1.0.0","entrypoints":["page"],"permissions":["agents.run"],"minPlatformVersion":"0.12.0"})).unwrap();
            state.install_capability(manifest).unwrap();
        }
        let host=AgentHost::default();let context=json!({"capabilityId":"example.meeting","version":"1.0.0"});
        assert_eq!(host.available(&state,"main",context.clone()).unwrap(),json!([]));
        assert!(host.available(&state,"package",context.clone()).unwrap_err().starts_with("PERMISSION_DENIED"));
        let scope=review::scope(&state,"example.meeting","1.0.0").unwrap();
        let intent=runs::Intent{instructions:"Meeting notes".into(),sources:vec![],agent_id:"codex".into(),policy_digest:"a".repeat(64),output_schema:None,component:Some(runs::ComponentIdentity{protocol_revision:1,sha256:"b".repeat(64)})};
        let run=runs::approve(&root,&scope,"one",&intent,||Ok(()),||Ok(vec![])).unwrap();
        runs::claim_submission(&root,&scope,&run.id,|_|Ok(())).unwrap();
        let binding=runs::native_binding(&root,&scope,&run.id,||Ok(())).unwrap();
        let native=runs::NativeIdentity{thread_id:"private-thread".into(),turn_id:Some("private-turn".into())};
        runs::record_native(&root,&scope,&binding,&native,||Ok(())).unwrap();
        runs::record_outcome(&root,&scope,&binding,&native,&runs::Outcome::Completed{text:"Retained meeting notes".into()},||Ok(())).unwrap();
        let mut query=context;query["runId"]=json!(run.id);
        let result=host.run(&state,"main",query.clone(),"get").await.unwrap();
        assert_eq!(result,json!({"id":run.id,"agentId":"codex","status":"completed","restored":false,"result":{"text":"Retained meeting notes"}}));
        query["capabilityId"]=json!("example.peer");assert!(host.run(&state,"main",query,"get").await.is_err());
        assert!(host.begin(&state,"main",json!({"requestId":"new","capabilityId":"example.meeting","version":"1.0.0","key":"new","proposal":{"agentId":"codex","instructions":"New","sources":[],"outputSchema":null}})).unwrap_err().starts_with("UNSUPPORTED_SERVICE"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn errors_do_not_leak_native_details_or_hide_uncertain_effects() {
        let raw="failed to open /private/auth.json";
        let error=serde_json::to_value(AgentError::native(raw.into(),true)).unwrap();
        assert_eq!(error["code"],"OUTCOME_UNKNOWN");assert!(!error.to_string().contains("/private"));
        assert_eq!(serde_json::to_value(AgentError::native(raw.into(),false)).unwrap()["code"],"RESOURCE_UNAVAILABLE");
    }
}
