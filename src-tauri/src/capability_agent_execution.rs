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
        match &self.settings.authentication {
            crate::capability_codex::Authentication::CodexFile{path} if !path.is_file()=>return Err("UNSUPPORTED_SERVICE: sign in with Codex file authentication first".into()),
            _=>(),
        }
        self.settings.policy()
    }
    fn read(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<runs::Run,String> {
        if caller!="main" {return Err("PERMISSION_DENIED: Agent execution requires the Host".into());}
        let scope=review::scope(state,id,version)?;
        runs::get(state.data_dir(),&scope,run_id,||review::current(state.data_dir(),&scope))
    }
    #[cfg(unix)]
    async fn session(&self,root:&std::path::Path,run:&runs::Run,require_current:bool)->Result<Arc<Active>,String> {
        let mut sessions=self.sessions.lock().await;
        if let Some(session)=sessions.get(&run.id) {return Ok(session.clone());}
        let launch=runs::native_launch_input(root,&run.scope,&run.id,||if require_current{review::current(root,&run.scope)}else{Ok(())})?;
        let run_id=run.id.clone();let events=self.events.clone();
        let settings=self.settings.retained(root,&launch)?;
        let session=Session::open(root,launch,&settings,Arc::new(move|event|events(&run_id,event))).await?;
        let active=Arc::new(Active{session,gate:Mutex::new(())});sessions.insert(run.id.clone(),active.clone());
        let weak=Arc::downgrade(&active);let root=root.to_path_buf();let retained=run.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let Some(active)=weak.upgrade() else{break};
                let _gate=active.gate.lock().await;
                match Self::maintain(&root,&retained,&active.session).await {
                    Ok(true)=>{active.session.stop_owned_process().await;break;},
                    Ok(false)=>(),
                    Err(error) if error.starts_with("PERMISSION_DENIED")=>{active.session.interrupt_and_stop().await;break;},
                    Err(_)=>(), // A lost acknowledgement remains pending and is reconciled next time.
                }
            }
        });Ok(active)
    }
    /// Reattach only to retained native provenance. Recovery never claims or submits a turn.
    #[cfg(unix)]
    pub async fn recover(&self,root:&std::path::Path,initial_ids:&[String])->Result<bool,String> {
        let unfinished:Vec<_>=runs::unfinished(root)?.into_iter().filter(|run|initial_ids.contains(&run.id)).collect();
        let pending=!unfinished.is_empty();
        for mut run in unfinished {
            if self.sessions.lock().await.contains_key(&run.id) {continue;}
            if !run.cancellation_requested && (run.parent.is_some() || review::current(root,&run.scope).is_err()) {
                run=runs::request_cancellation(root,&run.scope,&run.id)?;
            }
            if run.outcome.is_some() || run.submission==runs::Submission::Approved {continue;}
            let provenance=root.join("capability-agent-native").join(&run.id).join("codex/.nooki-run-provenance.json");
            if !provenance.is_file() {continue;}
            // A failed startup/policy check leaves the original claim uncertain. Other runs can recover.
            let Ok(active)=self.session(root,&run,false).await else{continue};
            let _gate=active.gate.lock().await;
            // Native resume loads the same bound thread; it does not create or replay a turn.
            if active.session.thread().await.is_err() {continue;}
            let _=Self::maintain(root,&run,&active.session).await;
        } Ok(pending)
    }
    #[cfg(unix)]
    async fn maintain(root:&std::path::Path,retained:&runs::Run,session:&Session)->Result<bool,String> {
        let mut run=runs::get(root,&retained.scope,&retained.id,||Ok(()))?;
        if run.restored {return Ok(true);}
        if run.outcome.is_some() {return Ok(true);}
        let authority=runs::get(root,&run.scope,&run.id,|| {
            review::current(root,&run.scope)?;runs::admission(root,&run)?;
            crate::document_grants::task_documents(root,&run.scope.installation,&run.intent.sources)?;Ok(())
        });
        if let Err(error)=authority {
            if error.starts_with("RESOURCE_BUSY") {return Ok(false);}
            run=runs::request_cancellation(root,&run.scope,&run.id)?;
        }
        let Some((native,outcome))=session.observe().await? else{return Ok(false)};
        let binding=runs::native_binding(root,&run.scope,&run.id,||Ok(()))?;
        runs::record_native(root,&run.scope,&binding,&native,||Ok(()))?;
        if let Some(outcome)=outcome {
            runs::record_outcome(root,&run.scope,&binding,&native,&outcome,||Ok(()))?;return Ok(true);
        }
        if run.cancellation_requested {session.cancel(&native).await?;}
        Ok(false)
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
        let active=self.session(state.data_dir(),&run,true).await?;let _gate=active.gate.lock().await;
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
            runs::admission(root,&run)?;
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
        let active=self.session(state.data_dir(),&run,true).await?;let _gate=active.gate.lock().await;
        let thread=active.session.thread().await?;
        let binding=review::native_binding(state,id,version,run_id)?;
        review::record_native(state,id,version,&binding,&thread)?;
        let saved=self.observed(state,&run,&active.session).await?;
        Ok(review::metadata(&saved))
    }
    pub async fn progress(&self,id:&str)->Option<Value> {
        self.sessions.lock().await.get(id).and_then(|active|active.session.progress())
    }
    #[cfg(unix)]
    pub async fn questions(&self,state:&PlatformState,caller:&str)->Result<Value,String> {
        if caller!="main" {return Err("PERMISSION_DENIED: questions require the Host".into());}
        let sessions:Vec<_>=self.sessions.lock().await.iter().map(|(id,active)|(id.clone(),active.clone())).collect();
        let mut result=Vec::new();let installed=state.list_capabilities()?;
        for run in runs::unfinished(state.data_dir())? {
            if run.cancellation_requested||run.restored||review::current(state.data_dir(),&run.scope).is_err()||runs::admission(state.data_dir(),&run).is_err()||crate::document_grants::task_documents(state.data_dir(),&run.scope.installation,&run.intent.sources).is_err(){continue;}
            let Some(native)=run.native.as_ref() else{continue};
            let Some((_,active))=sessions.iter().find(|(id,_)|id==&run.id) else{continue};
            let Some(package)=installed.iter().find(|p|p.manifest.id==run.scope.installation.capability_id) else{continue};
            for question in active.session.questions(native) {
                result.push(serde_json::json!({"runId":run.id,"capabilityId":run.scope.installation.capability_id,"version":run.scope.installation.capability_version,
                    "name":package.manifest.name,"locales":package.manifest.locales,"handle":question["handle"],"answerPending":question["answerPending"],"questions":question["questions"],"unsupported":question["unsupported"]}));
            }
        }Ok(Value::Array(result))
    }
    #[cfg(unix)]
    pub async fn answer(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str,handle:&str,answers:&Value)->Result<(),String> {
        let run=self.read(state,caller,id,version,run_id)?;
        let active=self.sessions.lock().await.get(run_id).cloned().ok_or("CONFLICT: native question is no longer attached")?;
        let _gate=active.gate.lock().await;
        let run=self.observed(state,&run,&active.session).await?;
        if run.restored||run.outcome.is_some()||run.cancellation_requested {return Err("CONFLICT: run no longer accepts answers".into());}
        let root=state.data_dir();
        let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is busy")?;
        crate::user_data::ensure_restore_complete(root)?;let _authority=crate::capability_authority::fence(root)?;
        review::current(root,&run.scope)?;runs::admission(root,&run)?;
        crate::document_grants::task_documents(root,&run.scope.installation,&run.intent.sources)?;
        let native=run.native.as_ref().ok_or("CONFLICT: native turn is unavailable")?;
        active.session.answer(native,handle,answers).await
    }
    #[cfg(unix)]
    pub async fn cancel(&self,state:&PlatformState,caller:&str,id:&str,version:&str,run_id:&str)->Result<Value,String> {
        let run=self.read(state,caller,id,version,run_id)?;
        if run.outcome.is_some() {return Ok(review::metadata(&run));}
        if run.submission==runs::Submission::Approved {
            return runs::cancel_unsubmitted(state.data_dir(),&run.scope,run_id,||review::current(state.data_dir(),&run.scope)).map(|run|review::metadata(&run));
        }
        runs::request_cancellation(state.data_dir(),&run.scope,&run.id)?;
        let active=self.session(state.data_dir(),&run,true).await?;let _gate=active.gate.lock().await;
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
        let executor=Executor::new(Settings{binary,component,questions:true,model:"mock-model".into(),authentication:Authentication::Fixture{url}},Arc::new(|_,_|{}));
        let host=crate::capability_agent_host::AgentHost{executor:Some(executor)};
        for (index,(key,mode)) in [("normal","normal"),("hold-for-cancellation","direct"),("hold-for-cancellation-parent","parent"),("hold-for-cancellation-revoke","revoke")].into_iter().enumerate() {
            let cancel=mode!="normal";
            if mode=="parent" {state.write_tasks(&[json!({"id":"meeting-job","attempt":1,"status":"running","capabilityId":"example.meeting","capabilityVersion":"1.0.0"})]).unwrap();}
            let ticket=host.begin(&state,"main",json!({"requestId":key,"capabilityId":"example.meeting","version":"1.0.0","key":key,"executionId":if mode=="parent"{Some("meeting-job:1")}else{None},
                "proposal":{"instructions":format!("nooki-native-model-probe: {key}"),"sources":[],"agentId":"codex","outputSchema":null}})).unwrap();
            let approved=host.approve(&state,"main",json!({"handle":ticket["handle"]})).unwrap();
            let id=approved["id"].as_str().unwrap();
            let query=json!({"capabilityId":"example.meeting","version":"1.0.0","runId":id});
            assert!(host.run(&state,"package",query.clone(),"start").await.is_err());
            let started=host.run(&state,"main",query.clone(),"start").await.unwrap();assert_eq!(started["id"],id);
            let scope=review::scope(&state,"example.meeting","1.0.0").unwrap();
            if cancel {
                tokio::time::timeout(Duration::from_secs(20),async {while count.load(Ordering::SeqCst)<index+1 {tokio::time::sleep(Duration::from_millis(50)).await;}}).await.unwrap();
                match mode {
                    "parent"=>{assert!(runs::cancel_parent(&root,"meeting-job:1").unwrap());},
                    "revoke"=>{state.set_capability_enabled("example.meeting",false).unwrap();assert!(host.run(&state,"main",query.clone(),"get").await.is_err());},
                    _=>{host.run(&state,"main",query.clone(),"cancel").await.unwrap();},
                }
            }
            let completed=tokio::time::timeout(Duration::from_secs(30),async {loop {
                let value=if mode=="revoke" {review::snapshot(&runs::get(&root,&scope,id,||Ok(())).unwrap())}
                    else {host.run(&state,"main",query.clone(),"get").await.unwrap()};
                if value["status"]=="completed" || value["status"]=="cancelled" {break value;}
                tokio::time::sleep(Duration::from_millis(100)).await;
            }}).await.unwrap();
            assert_eq!(completed["status"],if cancel{"cancelled"}else{"completed"});
            if !cancel {assert_eq!(completed["result"]["text"],"Meeting notes ready");}
            assert_eq!(completed["cancellationRequested"],cancel);
            if mode!="revoke" {
                assert_eq!(host.run(&state,"main",query.clone(),"start").await.unwrap(),completed);
                assert_eq!(review::public_get(&state,"main","example.meeting","1.0.0",id).unwrap(),completed);
            }
            if mode=="parent" {assert!(!runs::cancel_parent(&root,"meeting-job:1").unwrap());}
        }
        assert_eq!(count.load(Ordering::SeqCst),4,"Each approval dispatched once, including cancellation");
        for active in host.executor.as_ref().unwrap().sessions.lock().await.values() {active.session.stop_test_process().await;}
        drop(host);server.abort();let _=server.await;fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore="requires pinned capability Codex; local synthetic Responses only"]
    async fn startup_recovers_completed_output_and_interrupts_orphaned_children_without_resubmission() {
        let binary=PathBuf::from(std::env::var_os("NOOKI_CAPABILITY_NATIVE_BIN").expect("pinned component required"));
        let component=runs::ComponentIdentity{protocol_revision:2,sha256:format!("{:x}",Sha256::digest(fs::read(&binary).unwrap()))};
        let root=std::env::temp_dir().join(format!("nooki-agent-startup-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        state.install_capability(serde_json::from_value(json!({"id":"example.meeting","name":"Meeting","version":"1.0.0",
            "entrypoints":["page","job"],"permissions":["agents.run"],"minPlatformVersion":"0.14.0"})).unwrap()).unwrap();
        let (url,count,server)=crate::capability_codex::tests::responses().await;
        let settings=Settings{binary,component,questions:true,model:"mock-model".into(),authentication:Authentication::Fixture{url}};
        let host=crate::capability_agent_host::AgentHost{executor:Some(Executor::new(settings.clone(),Arc::new(|_,_|{})))};
        for (key,orphan) in [("cold-completed",false),("hold-for-cancellation-orphan",true)] {
            if orphan {state.write_tasks(&[json!({"id":"prior-job","attempt":1,"status":"running","capabilityId":"example.meeting","capabilityVersion":"1.0.0"})]).unwrap();}
            let ticket=host.begin(&state,"main",json!({"requestId":key,"capabilityId":"example.meeting","version":"1.0.0","key":key,
                "executionId":if orphan{Some("prior-job:1")}else{None},
                "proposal":{"instructions":format!("nooki-native-model-probe: {key}"),"sources":[],"agentId":"codex","outputSchema":null}})).unwrap();
            let approved=host.approve(&state,"main",json!({"handle":ticket["handle"]})).unwrap();
            let id=approved["id"].as_str().unwrap();
            let run=review::claim(&state,"main","example.meeting","1.0.0",id,|_|settings.policy()).unwrap();
            let launch=runs::native_launch_input(&root,&run.scope,id,||Ok(())).unwrap();
            let binding=launch.binding.clone();let session=Session::open(&root,launch,&settings,Arc::new(|_|{})).await.unwrap();
            let thread=session.thread().await.unwrap();runs::record_native(&root,&run.scope,&binding,&thread,||Ok(())).unwrap();
            let native=session.submit().await.unwrap();runs::record_native(&root,&run.scope,&binding,&native,||Ok(())).unwrap();
            let mut current=settings.clone();current.model="newly-selected-model".into();
            let recovered=Executor::new(current,Arc::new(|_,_|{}));
            assert!(!recovered.recover(&root,&[]).await.unwrap(),"A later run is not part of the startup inventory");
            assert!(!runs::get(&root,&run.scope,id,||Ok(())).unwrap().cancellation_requested);
            if orphan {
                tokio::time::timeout(Duration::from_secs(20),async{while count.load(Ordering::SeqCst)<2 {tokio::time::sleep(Duration::from_millis(50)).await;}}).await.unwrap();
            } else {
                tokio::time::timeout(Duration::from_secs(30),async{loop {
                    if session.observe().await.unwrap().is_some_and(|(_,outcome)|outcome.is_some()) {break;}
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }}).await.unwrap();
                session.stop_owned_process().await;
            }
            recovered.recover(&root,&[id.into()]).await.unwrap();
            let finished=tokio::time::timeout(Duration::from_secs(30),async{loop {
                let run=runs::get(&root,&run.scope,id,||Ok(())).unwrap();if run.outcome.is_some() {break run;}
                tokio::time::sleep(Duration::from_millis(100)).await;
            }}).await.unwrap();
            assert_eq!(finished.cancellation_requested,orphan);
            assert_eq!(finished.outcome,Some(if orphan{runs::Outcome::Cancelled}else{runs::Outcome::Completed{text:"Meeting notes ready".into()}}));
            session.stop_owned_process().await;
            for active in recovered.sessions.lock().await.values() {active.session.stop_owned_process().await;}
        }
        assert_eq!(count.load(Ordering::SeqCst),2,"Startup recovery never submits another turn");
        drop(host);server.abort();let _=server.await;fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore="requires pinned capability Codex; synthetic local Responses only"]
    async fn native_question_is_host_answered_and_same_run_finishes() {
        let binary=PathBuf::from(std::env::var_os("NOOKI_CAPABILITY_NATIVE_BIN").expect("pinned component required"));
        let component=runs::ComponentIdentity{protocol_revision:2,sha256:format!("{:x}",Sha256::digest(fs::read(&binary).unwrap()))};
        let root=std::env::temp_dir().join(format!("nooki-question-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.meeting","name":"Meeting notes","version":"1.0.0","entrypoints":["page"],"permissions":["agents.run"],"minPlatformVersion":"0.12.0"})).unwrap();
        state.install_capability(manifest).unwrap();let (url,count,server)=crate::capability_codex::tests::responses().await;
        let executor=Executor::new(Settings{binary,component,questions:true,model:"mock-model".into(),authentication:Authentication::Fixture{url}},Arc::new(|_,_|{}));
        let ticket=review::begin(&state,"main",json!({"requestId":"question","capabilityId":"example.meeting","version":"1.0.0","key":"question","proposal":{"instructions":"nooki-native-model-probe: ask-user-probe","sources":[],"agentId":"codex","outputSchema":null}}),|agent|executor.policy(agent)).unwrap();
        let approved=review::approve(&state,"main",json!({"handle":ticket["handle"]}),|agent|executor.policy(agent)).unwrap();
        let id=approved["runId"].as_str().unwrap();executor.start(&state,"main","example.meeting","1.0.0",id).await.unwrap();
        let question=tokio::time::timeout(Duration::from_secs(30),async{loop{
            let questions=executor.questions(&state,"main").await.unwrap();if let Some(q)=questions.as_array().unwrap().first(){break q.clone();}
            tokio::time::sleep(Duration::from_millis(100)).await;
        }}).await.unwrap();
        assert_eq!(question["unsupported"],false);assert_eq!(question["questions"][0]["title"],"Choose the meeting title");
        let handle=question["handle"].as_str().unwrap();
        assert!(executor.answer(&state,"pet","example.meeting","1.0.0",id,handle,&json!(["Release notes"])).await.is_err());
        assert!(executor.answer(&state,"main","example.foreign","1.0.0",id,handle,&json!(["Release notes"])).await.is_err());
        executor.answer(&state,"main","example.meeting","1.0.0",id,handle,&json!(["Release notes"])).await.unwrap();
        let result=tokio::time::timeout(Duration::from_secs(30),async{loop{
            executor.observe(&state,"main","example.meeting","1.0.0",id).await.unwrap();
            let result=review::public_get(&state,"main","example.meeting","1.0.0",id).unwrap();
            if result["status"]=="completed"{break result;}tokio::time::sleep(Duration::from_millis(100)).await;
        }}).await.unwrap();
        assert_eq!(result["result"]["text"],"Meeting notes ready");assert_eq!(count.load(Ordering::SeqCst),2);
        assert!(executor.questions(&state,"main").await.unwrap().as_array().unwrap().is_empty());
        assert!(executor.answer(&state,"main","example.meeting","1.0.0",id,handle,&json!(["Release notes"])).await.is_err());
        for active in executor.sessions.lock().await.values(){active.session.stop_owned_process().await;}
        server.abort();fs::remove_dir_all(root).unwrap();
    }

}
