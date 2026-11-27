//! Connect the Host review/journal to the dedicated native Codex session owner.
//! This is transport/lifecycle orchestration, not another model runner or approval authority.
use crate::{capability_agent_review as review,capability_agent_runs as runs,
    capability_codex::{Session,Settings},capability_runtime::PlatformState};
use serde_json::Value;
use std::{collections::BTreeMap,sync::Arc};
use tokio::sync::Mutex;

struct Active {session:Session,gate:Mutex<()>}
pub(crate) struct Executor {
    settings:Settings,
    sessions:Mutex<BTreeMap<String,Arc<Active>>>,
    events:Arc<dyn Fn(&str,Value)+Send+Sync>,
}
impl Executor {
    pub fn new(settings:Settings,events:Arc<dyn Fn(&str,Value)+Send+Sync>)->Self {
        Self{settings,sessions:Mutex::new(BTreeMap::new()),events}
    }
    pub fn policy(&self,agent:&str)->Result<runs::ResolvedPolicy,String> {
        if agent!="codex" {return Err("UNSUPPORTED_SERVICE: this execution owner supports Codex".into());}
        self.settings.policy()
    }
    fn read(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<runs::Run,String> {
        if caller!="main" {return Err("PERMISSION_DENIED: Agent execution requires the Host".into());}
        let scope=review::scope(state,id,version)?;
        runs::get(state.data_dir(),&scope,run_id,||review::current(state.data_dir(),&scope))
    }
    #[cfg(unix)]
    async fn session(&self,state:&PlatformState,run:&runs::Run)->Result<Arc<Active>,String> {
        let mut sessions=self.sessions.lock().await;
        if let Some(session)=sessions.get(&run.id) {return Ok(session.clone());}
        let launch=runs::native_launch_input(state.data_dir(),&run.scope,&run.id,||review::current(state.data_dir(),&run.scope))?;
        let run_id=run.id.clone();let events=self.events.clone();
        let session=Session::open(state.data_dir(),launch,&self.settings,Arc::new(move|event|events(&run_id,event))).await?;
        let active=Arc::new(Active{session,gate:Mutex::new(())});sessions.insert(run.id.clone(),active.clone());Ok(active)
    }
    #[cfg(unix)]
    async fn observed(&self,state:&PlatformState,run:&runs::Run,session:&Session)->Result<runs::Run,String> {
        let binding=review::native_binding(state,&run.scope.installation.capability_id,&run.scope.installation.capability_version,&run.id)?;
        if let Some((native,outcome))=session.observe().await? {
            let saved=review::record_native(state,&run.scope.installation.capability_id,&run.scope.installation.capability_version,&binding,&native)?;
            if let Some(outcome)=outcome {
                return runs::record_outcome(state.data_dir(),&run.scope,&binding,&native,&outcome,||review::current(state.data_dir(),&run.scope));
            }
            return Ok(saved);
        }
        Ok(run.clone())
    }
    #[cfg(unix)]
    pub async fn start(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<Value,String> {
        // Read/replay of a completed run never depends on the currently selected model/component.
        let prior=self.read(state,caller,id,version,run_id)?;
        if prior.outcome.is_some() {return Ok(review::metadata(&prior));}
        if prior.submission!=runs::Submission::Approved {return self.observe(state,caller,id,version,run_id).await;}
        let run=review::claim(state,caller,id,version,run_id,|agent|self.policy(agent))?;
        let active=self.session(state,&run).await?;let _gate=active.gate.lock().await;
        let binding=review::native_binding(state,id,version,run_id)?;
        let thread=active.session.thread().await?;
        review::record_native(state,id,version,&binding,&thread)?;
        // Hold the same cross-process fences as disable/update, source revocation and restore
        // through the bounded native admission acknowledgement. There is no check/submit gap.
        let native={
            let root=state.data_dir();
            let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: Agent submission is waiting for user data")?;
            crate::user_data::ensure_restore_complete(root)?;
            let _authority=crate::capability_authority::fence(root)?;
            review::current(root,&run.scope)?;
            crate::document_grants::task_documents(root,&run.scope.installation,&run.intent.sources)?;
            active.session.submit().await?
        };
        Ok(review::metadata(&review::record_native(state,id,version,&binding,&native)?))
    }
    #[cfg(unix)]
    pub async fn observe(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<Value,String> {
        let run=self.read(state,caller,id,version,run_id)?;
        if run.outcome.is_some() || run.submission==runs::Submission::Approved {return Ok(review::metadata(&run));}
        // A journal claim alone cannot start a native process on an observation request.
        if run.native.is_none() && !state.data_dir().join("capability-agent-native").join(run_id).join("codex/.nooki-run-provenance.json").is_file() {
            return Ok(review::metadata(&run));
        }
        let active=self.session(state,&run).await?;let _gate=active.gate.lock().await;
        let thread=active.session.thread().await?;
        let binding=review::native_binding(state,id,version,run_id)?;
        review::record_native(state,id,version,&binding,&thread)?;
        let saved=self.observed(state,&run,&active.session).await?;
        Ok(review::metadata(&saved))
    }
    #[cfg(unix)]
    pub async fn cancel(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<Value,String> {
        let run=self.read(state,caller,id,version,run_id)?;
        if run.outcome.is_some() {return Ok(review::metadata(&run));}
        if run.submission==runs::Submission::Approved {
            return runs::cancel_unsubmitted(state.data_dir(),&run.scope,run_id,||review::current(state.data_dir(),&run.scope)).map(|run|review::metadata(&run));
        }
        let active=self.session(state,&run).await?;let _gate=active.gate.lock().await;
        let run=self.observed(state,&run,&active.session).await?;
        if run.outcome.is_none() {
            let native=run.native.as_ref().ok_or("OUTCOME_UNKNOWN: native execution must be reconciled before cancellation")?;
            active.session.cancel(native).await?;
        }
        // An interrupt acknowledgement is not proof of a terminal outcome. Read native state;
        // if it is still running, the UI must keep observing instead of saying cancellation won.
        Ok(review::metadata(&self.observed(state,&run,&active.session).await?))
    }
}

#[cfg(all(test,unix))]
mod tests {
    use super::*;
    use crate::{capability_codex::Authentication,capability_runtime::CapabilityManifest};
    use serde_json::json;
    use sha2::{Digest,Sha256};
    use std::{fs,path::PathBuf,sync::atomic::Ordering,time::Duration};
    #[tokio::test]
    #[ignore="requires pinned capability Codex; only local synthetic Responses are used"]
    async fn reviewed_request_completes_and_cancellation_keeps_the_original_run() {
        let binary=PathBuf::from(std::env::var_os("NOOKI_CAPABILITY_NATIVE_BIN").expect("pinned component required"));
        let component=runs::ComponentIdentity{protocol_revision:2,sha256:format!("{:x}",Sha256::digest(fs::read(&binary).unwrap()))};
        let root=std::env::temp_dir().join(format!("nooki-reviewed-execution-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.meeting","name":"Meeting notes","version":"1.0.0",
            "entrypoints":["page"],"permissions":["agents.run"],"minPlatformVersion":"0.12.0"})).unwrap();
        state.install_capability(manifest).unwrap();
        let (url,count,server)=crate::capability_codex::tests::responses().await;
        let executor=Executor::new(Settings{binary,component,model:"mock-model".into(),authentication:Authentication::Fixture{url}},Arc::new(|_,_|{}));
        let host=crate::capability_agent_host::AgentHost{executor:Some(executor)};
        for (key,cancel) in [("normal",false),("hold-for-cancellation",true)] {
            let ticket=host.begin(&state,"main",json!({"requestId":key,"capabilityId":"example.meeting","version":"1.0.0","key":key,
                "proposal":{"instructions":format!("nooki-native-model-probe: {key}"),"sources":[],"agentId":"codex","outputSchema":null}})).unwrap();
            let approved=host.approve(&state,"main",json!({"handle":ticket["handle"]})).unwrap();
            let id=approved["id"].as_str().unwrap();
            let query=json!({"capabilityId":"example.meeting","version":"1.0.0","runId":id});
            assert!(host.run(&state,"package",query.clone(),"start").await.is_err());
            let started=host.run(&state,"main",query.clone(),"start").await.unwrap();assert_eq!(started["id"],id);
            if cancel {
                tokio::time::timeout(Duration::from_secs(20),async {while count.load(Ordering::SeqCst)<2 {tokio::time::sleep(Duration::from_millis(50)).await;}}).await.unwrap();
                host.run(&state,"main",query.clone(),"cancel").await.unwrap();
            }
            let completed=tokio::time::timeout(Duration::from_secs(30),async {loop {
                let value=host.run(&state,"main",query.clone(),"get").await.unwrap();
                if value["status"]=="completed" || value["status"]=="cancelled" {break value;}
                tokio::time::sleep(Duration::from_millis(100)).await;
            }}).await.unwrap();
            assert_eq!(completed["status"],if cancel{"cancelled"}else{"completed"});
            if !cancel {assert_eq!(completed["result"]["text"],"Meeting notes ready");}
            assert_eq!(host.run(&state,"main",query.clone(),"start").await.unwrap(),completed);
            assert_eq!(review::public_get(&state,"main","example.meeting","1.0.0",id).unwrap(),completed);
        }
        assert_eq!(count.load(Ordering::SeqCst),2,"Each approval dispatched once, including cancellation");
        for active in host.executor.as_ref().unwrap().sessions.lock().await.values() {active.session.stop_test_process().await;}
        drop(host);server.abort();let _=server.await;fs::remove_dir_all(root).unwrap();
    }
}
