use super::*;
use crate::{capability_runtime::CapabilityManifest, document_library::DocumentPublication, user_data};
use serde_json::json;
use std::{fs,path::PathBuf};

struct Fixture {root:PathBuf,state:PlatformState}
impl Fixture {
    fn new()->Self {
        let root=std::env::temp_dir().join(format!("nooki-agent-review-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        for id in ["example.reader","example.peer"] {
            let manifest:CapabilityManifest=serde_json::from_value(json!({"id":id,"name":id,"version":"1.0.0","entrypoints":["page"],
                "permissions":["agents.run","documents.publish","documents.read-selected"],"minPlatformVersion":"0.12.0"})).unwrap();
            state.install_capability(manifest).unwrap();
        }
        Self {root,state}
    }
    fn request(&self,id:&str,key:&str)->Value {json!({"requestId":id,"capabilityId":"example.reader","version":"1.0.0","key":key,
        "proposal":{"instructions":"Summarize the selected material","sources":[],"agentId":"codex","outputSchema":null}})}
    fn begin(&self,id:&str,key:&str)->Value {begin(&self.state,"main",self.request(id,key),policy).unwrap()}
    fn approve(&self,ticket:&Value)->Value {approve(&self.state,"main",json!({"handle":ticket["handle"]}),policy).unwrap()}
    fn claim(&self,receipt:&Value)->Result<runs::Run,String> {claim(&self.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),policy)}
    fn source(&self)->DocumentReference {
        let doc=self.state.publish_document("example.reader",DocumentPublication {key:"input".into(),title:"Selected notes".into(),collection_key:"notes".into(),collection_name:"Notes".into(),document_date:"2026-11-26".into(),content:"Original selected text".into()}).unwrap();
        self.state.grant_documents("example.reader",vec![doc.id],"agent-source").unwrap().documents.remove(0).reference
    }
}
impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}
fn policy(agent:&str)->Result<ResolvedPolicy,String> {assert_eq!(agent,"codex");Ok(ResolvedPolicy {digest:"b".repeat(64),component:runs::ComponentIdentity {protocol_revision:1,sha256:"d".repeat(64)}})}

#[test]
fn host_review_precedes_durable_approval_and_restart_replay_never_submits_twice() {
    let f=Fixture::new();assert!(begin(&f.state,"package",f.request("foreign","key"),policy).is_err());
    let ticket=f.begin("review","key");assert_eq!(f.begin("review","key"),ticket);
    assert!(!f.root.join("capability-agent-runs.json").exists());
    assert!(approve(&f.state,"package",json!({"handle":ticket["handle"]}),policy).is_err());
    let receipt=f.approve(&ticket);assert_eq!(f.approve(&ticket),receipt);
    let restarted=PlatformState::load(f.root.clone()).unwrap();
    let replay=begin(&restarted,"main",f.request("replay","key"),policy).unwrap();
    assert_eq!(replay["status"],"approved");assert_eq!(replay["runId"],receipt["runId"]);
    let run=claim(&restarted,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),policy).unwrap();
    assert!(matches!(run.submission,runs::Submission::Pending {..}));
    assert!(f.claim(&receipt).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
    assert!(claim(&f.state,"main","example.peer","1.0.0",&run.id,policy).is_err());
}

#[test]
fn dismissal_expiry_and_changed_policy_have_no_execution_effect() {
    let f=Fixture::new();let dismissed=f.begin("dismissed","one");
    cancel(&f.state,"main",json!({"requestId":"dismissed"})).unwrap();
    assert!(approve(&f.state,"main",json!({"handle":dismissed["handle"]}),policy).is_err());
    let expired=f.begin("expired","two");
    f.state.agent_reviews.lock().unwrap().get_mut(expired["handle"].as_str().unwrap()).unwrap().expires_at=Instant::now();
    assert!(approve(&f.state,"main",json!({"handle":expired["handle"]}),policy).is_err());
    let ticket=f.begin("changed-policy","three");
    assert!(approve(&f.state,"main",json!({"handle":ticket["handle"]}),|_|Ok(ResolvedPolicy {digest:"c".repeat(64),..policy("codex")?})).is_err());
    assert!(!f.root.join("capability-agent-runs.json").exists());
    let receipt=f.approve(&ticket);
    assert!(claim(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),|_|Ok(ResolvedPolicy {digest:"c".repeat(64),..policy("codex")?})).is_err());
    assert_eq!(get(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap()).unwrap()["submission"]["state"],"approved");
}

#[test]
fn native_source_ownership_and_revocation_are_checked_before_review_approval_and_claim() {
    let f=Fixture::new();let selected=f.source();let mut request=f.request("source","key");request["proposal"]["sources"]=json!([selected]);
    let mut foreign=request.clone();foreign["capabilityId"]=json!("example.peer");foreign["requestId"]=json!("foreign");
    assert!(begin(&f.state,"main",foreign,policy).unwrap_err().starts_with("PERMISSION_DENIED"));
    let ticket=begin(&f.state,"main",request.clone(),policy).unwrap();
    let receipt=f.approve(&ticket);f.state.revoke_document_grant("agent-source").unwrap();
    assert!(f.claim(&receipt).unwrap_err().starts_with("PERMISSION_DENIED"));
    request["requestId"]=json!("metadata-retry");
    assert_eq!(begin(&f.state,"main",request.clone(),policy).unwrap()["runId"],receipt["runId"]);
    let observed=get(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap()).unwrap();
    assert_eq!(observed["submission"]["state"],"approved");
    assert!(observed.get("documents").is_none());assert!(observed.get("intent").is_none());
    request["key"]=json!("different-work");assert!(begin(&f.state,"main",request,policy).is_err());

    let before_approval=Fixture::new();let mut request=before_approval.request("source","key");request["proposal"]["sources"]=json!([before_approval.source()]);
    let ticket=begin(&before_approval.state,"main",request,policy).unwrap();before_approval.state.revoke_document_grant("agent-source").unwrap();
    assert!(approve(&before_approval.state,"main",json!({"handle":ticket["handle"]}),policy).is_err());
    assert!(!before_approval.root.join("capability-agent-runs.json").exists());
}

#[test]
fn install_disable_update_reinstall_and_permission_removal_invalidate_reviews_and_runs() {
    for change in ["disable","update","reinstall","permission"] {
        let f=Fixture::new();let approved=f.approve(&f.begin("approved","one"));let pending=f.begin("pending","two");
        let mut manifest=f.state.list_capabilities().unwrap().into_iter().find(|c|c.manifest.id=="example.reader").unwrap().manifest;
        match change {
            "disable"=>{f.state.set_capability_enabled("example.reader",false).unwrap();f.state.set_capability_enabled("example.reader",true).unwrap();}
            "update"=>{manifest.version="1.0.1".into();f.state.update_capability(manifest).unwrap();}
            "reinstall"=>{f.state.uninstall_capability("example.reader").unwrap();f.state.install_capability(manifest).unwrap();}
            _=>{manifest.permissions.retain(|p|*p!=CapabilityPermission::AgentsRun);f.state.update_capability(manifest).unwrap();}
        }
        assert!(approve(&f.state,"main",json!({"handle":pending["handle"]}),policy).is_err(),"{change}");
        assert!(f.claim(&approved).is_err(),"{change}");
        assert!(get(&f.state,"main","example.reader","1.0.0",approved["runId"].as_str().unwrap()).is_err(),"{change}");
    }
}

#[test]
fn legacy_ai_permission_and_old_platform_floor_do_not_grant_agent_run_authority() {
    let f=Fixture::new();let mut manifest=f.state.list_capabilities().unwrap().into_iter().find(|c|c.manifest.id=="example.reader").unwrap().manifest;
    manifest.min_platform_version="0.11.0".into();assert!(f.state.update_capability(manifest.clone()).unwrap_err().contains("0.12.0"));
    manifest.permissions.retain(|p|*p!=CapabilityPermission::AgentsRun);manifest.permissions.push(CapabilityPermission::AiInvoke);
    f.state.update_capability(manifest).unwrap();
    assert!(begin(&f.state,"main",f.request("legacy","key"),|_|panic!("legacy permission reached Agent policy")).is_err());
}

#[test]
fn changed_proposal_correlation_and_package_supplied_authority_are_rejected() {
    let f=Fixture::new();let ticket=f.begin("original","key");
    for (field,value) in [("instructions",json!("Different work")),("outputSchema",json!({"type":"object"}))] {
        let mut changed=f.request("original","key");changed["proposal"][field]=value;
        assert!(begin(&f.state,"main",changed.clone(),policy).unwrap_err().starts_with("CONFLICT"));
        f.approve(&ticket);changed["requestId"]=json!("new-review");
        assert!(begin(&f.state,"main",changed,policy).unwrap_err().starts_with("CONFLICT"));
    }
    for field in ["owner","approvalId","policyDigest","scope","runId"] {
        let mut forged=f.request("forged","other");forged["proposal"][field]=json!("forged");
        assert!(begin(&f.state,"main",forged,policy).unwrap_err().starts_with("INVALID_INPUT"));
    }
    assert!(approve(&f.state,"main",json!({"handle":ticket["handle"],"approved":true}),policy).is_err());
    let mut changed=f.request("original","different-key");changed["capabilityId"]=json!("example.peer");
    assert!(begin(&f.state,"main",changed,policy).is_err());
}

#[test]
fn failed_write_and_unavailable_adapter_preserve_frozen_intent() {
    let f=Fixture::new();assert!(begin(&f.state,"main",f.request("unavailable","one"),|_|Err("UNSUPPORTED_SERVICE: unavailable".into())).is_err());
    let mut other=f.request("unsupported","two");other["proposal"]["agentId"]=json!("claude");
    assert!(begin(&f.state,"main",other,|_|panic!("unverified adapter consulted")).is_err());
    assert!(begin(&f.state,"main",f.request("invalid-policy","three"),|_|Ok(ResolvedPolicy {digest:"not-a-policy-proof".into(),..policy("codex")?})).is_err());
    let ticket=f.begin("approved","key");fs::create_dir(f.root.join("capability-agent-runs.pending")).unwrap();
    assert!(approve(&f.state,"main",json!({"handle":ticket["handle"]}),policy).is_err());
    assert!(!f.root.join("capability-agent-runs.json").exists());
    fs::remove_dir(f.root.join("capability-agent-runs.pending")).unwrap();let receipt=f.approve(&ticket);
    assert!(claim(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),|_|Err("UNSUPPORTED_SERVICE: unavailable".into())).is_err());
    assert!(matches!(f.claim(&receipt).unwrap().submission,runs::Submission::Pending {..}));
}

#[test]
fn restore_and_interrupted_restore_cannot_revive_review_or_dispatch_authority() {
    let f=Fixture::new();let ticket=f.begin("pending","one");let receipt=f.approve(&f.begin("approved","two"));
    let backup=user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    user_data::restore(&f.root,&backup,"agent-review-restore").unwrap();
    assert!(approve(&f.state,"main",json!({"handle":ticket["handle"]}),policy).is_err());assert!(f.claim(&receipt).is_err());
    fs::create_dir(f.root.join(".data-restore")).unwrap();fs::write(f.root.join(".data-restore/prepared.json"),"\"interrupted\"").unwrap();
    assert!(begin(&f.state,"main",f.request("interrupted","three"),|_|panic!("unrecovered restore consulted policy")).unwrap_err().starts_with("RESOURCE_BUSY"));
}

#[test]
fn bounded_reviews_release_capacity_and_unapproved_handles_expire_on_restart() {
    let f=Fixture::new();let first=f.begin("pending-0","key-0");
    for n in 1..16 {f.begin(&format!("pending-{n}"),&format!("key-{n}"));}
    assert!(begin(&f.state,"main",f.request("full","full"),policy).unwrap_err().starts_with("RESOURCE_LIMIT"));
    assert!(cancel(&f.state,"package",json!({"requestId":"pending-0"})).is_err());
    cancel(&f.state,"main",json!({"requestId":"pending-0"})).unwrap();f.begin("replacement","replacement");
    let restarted=PlatformState::load(f.root.clone()).unwrap();
    assert!(approve(&restarted,"main",json!({"handle":first["handle"]}),policy).is_err());
    assert!(!f.root.join("capability-agent-runs.json").exists());
}

#[test]
fn pending_submission_remains_unknown_even_when_original_sources_are_revoked() {
    let f=Fixture::new();let mut request=f.request("selected","key");request["proposal"]["sources"]=json!([f.source()]);
    let receipt=f.approve(&begin(&f.state,"main",request,policy).unwrap());f.claim(&receipt).unwrap();
    f.state.revoke_document_grant("agent-source").unwrap();
    assert!(f.claim(&receipt).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
    assert!(claim(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),|_|panic!("pending submission must not resolve another policy")).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
}

#[test]
fn policy_decisions_hold_data_and_installation_fences_through_authorization() {
    let f=Fixture::new();let fenced_policy=|agent:&str| {
        assert!(crate::task_worker::data_lock(&f.root).unwrap().is_none());
        assert!(crate::task_worker::file_lock(&f.root.join("capability-authority.lock")).unwrap().is_none());
        policy(agent)
    };
    let ticket=begin(&f.state,"main",f.request("fenced","key"),fenced_policy).unwrap();
    let receipt=approve(&f.state,"main",json!({"handle":ticket["handle"]}),fenced_policy).unwrap();
    claim(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),fenced_policy).unwrap();
}

#[test]
fn review_expiring_during_policy_validation_is_not_committed() {
    let f=Fixture::new();let ticket=f.begin("expired-during-check","key");
    let deadline=Instant::now()+Duration::from_millis(100);
    f.state.agent_reviews.lock().unwrap().get_mut(ticket["handle"].as_str().unwrap()).unwrap().expires_at=deadline;
    let result=approve(&f.state,"main",json!({"handle":ticket["handle"]}),|agent| {
        std::thread::sleep((deadline+Duration::from_millis(10)).saturating_duration_since(Instant::now()));policy(agent)
    });
    assert!(result.unwrap_err().starts_with("PERMISSION_DENIED"));
    assert!(!f.root.join("capability-agent-runs.json").exists());
}

#[test]
fn component_identity_is_native_owned_and_fixed_at_review_approval_and_claim() {
    let f=Fixture::new();let mut forged=f.request("forged-component","one");
    forged["proposal"]["component"]=json!({"protocolRevision":1,"sha256":"e".repeat(64)});
    assert!(begin(&f.state,"main",forged,policy).unwrap_err().starts_with("INVALID_INPUT"));
    let changed=|agent:&str| {let mut next=policy(agent)?;next.component.sha256="e".repeat(64);Ok(next)};
    let ticket=f.begin("component","one");
    assert!(approve(&f.state,"main",json!({"handle":ticket["handle"]}),changed).unwrap_err().starts_with("PERMISSION_DENIED"));
    let receipt=f.approve(&ticket);
    assert!(claim(&f.state,"main","example.reader","1.0.0",receipt["runId"].as_str().unwrap(),changed).unwrap_err().starts_with("PERMISSION_DENIED"));
    let run=f.claim(&receipt).unwrap();assert_eq!(run.intent.component,Some(policy("codex").unwrap().component));
}

#[test]
fn native_reconciliation_records_prior_submission_after_source_revocation_but_not_reenable() {
    let f=Fixture::new();let selected=f.source();let mut request=f.request("native","one");request["proposal"]["sources"]=json!([selected]);
    let receipt=f.approve(&begin(&f.state,"main",request,policy).unwrap());let run=f.claim(&receipt).unwrap();
    let binding=native_binding(&f.state,"example.reader","1.0.0",&run.id).unwrap();
    f.state.revoke_document_grant("agent-source").unwrap();
    let native=runs::NativeIdentity {thread_id:"thread".into(),turn_id:Some("turn".into())};
    assert_eq!(record_native(&f.state,"example.reader","1.0.0",&binding,&native).unwrap().native,Some(native.clone()));
    assert!(record_native(&f.state,"example.peer","1.0.0",&binding,&native).is_err());
    let metadata=get(&f.state,"main","example.reader","1.0.0",&run.id).unwrap();
    assert!(metadata.get("native").is_none());assert!(metadata.get("component").is_none());
    f.state.set_capability_enabled("example.reader",false).unwrap();
    assert!(native_binding(&f.state,"example.reader","1.0.0",&run.id).is_err());
    assert!(record_native(&f.state,"example.reader","1.0.0",&binding,&native).is_err());
    f.state.set_capability_enabled("example.reader",true).unwrap();
    assert!(native_binding(&f.state,"example.reader","1.0.0",&run.id).is_err());
    assert!(record_native(&f.state,"example.reader","1.0.0",&binding,&native).is_err());
}

#[test]
fn parent_attempt_is_host_bound_and_cancelled_attempt_cannot_be_revived() {
    let f=Fixture::new();let task=json!({"id":"meeting-job","attempt":1,"status":"running","capabilityId":"example.reader","capabilityVersion":"1.0.0"});
    f.state.write_tasks(&[task.clone()]).unwrap();
    let mut input=f.request("parent","parent");input["executionId"]=json!("meeting-job:1");
    let ticket=begin(&f.state,"main",input.clone(),policy).unwrap();let approved=f.approve(&ticket);
    let scope=scope(&f.state,"example.reader","1.0.0").unwrap();
    let run=runs::get(&f.root,&scope,approved["runId"].as_str().unwrap(),||Ok(())).unwrap();
    assert_eq!(run.parent.as_deref(),Some("meeting-job:1"));
    assert!(!runs::cancel_parent(&f.root,"meeting-job:1").unwrap());
    f.state.write_tasks(&[task]).unwrap(); // A stale renderer cannot remove native cancellation.
    assert!(begin(&f.state,"main",input.clone(),policy).unwrap_err().starts_with("CANCELLED"));
    assert!(f.claim(&approved).is_err());
    let run=runs::get(&f.root,&scope,&run.id,||Ok(())).unwrap();
    assert!(run.cancellation_requested);assert_eq!(run.outcome,Some(runs::Outcome::Cancelled));
    input["executionId"]=json!("meeting-job:2");
    assert!(begin(&f.state,"main",input.clone(),policy).unwrap_err().starts_with("PERMISSION_DENIED"));
    input["capabilityId"]=json!("example.peer");input["executionId"]=json!("meeting-job:1");
    assert!(begin(&f.state,"main",input,policy).is_err());
}
