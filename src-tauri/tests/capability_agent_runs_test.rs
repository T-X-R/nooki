use app_lib::{capability_agent_runs::{self as runs, Intent, Scope, Submission}, capability_authority::InvocationContext,
    document_grants::{DocumentReference, SelectedDocument}, user_data};
use serde_json::json;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut nonce=[0u8;16]; getrandom::fill(&mut nonce).unwrap();
        let root=std::env::temp_dir().join(format!("nooki-agent-ledger-{:x?}",nonce));
        fs::create_dir_all(&root).unwrap(); Self(root)
    }
    fn approve(&self,key:&str,input:&Intent)->Result<runs::Run,String> {
        runs::approve(&self.0,&scope(),key,input,|| Ok(()),|| Ok(vec![source()]))
    }
}
impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn scope()->Scope {Scope {installation:InvocationContext {capability_id:"example.reader".into(),capability_version:"1.0.0".into(),generation:"a".repeat(64)},restore_id:None}}
fn reference()->DocumentReference {DocumentReference {kind:"library-document".into(),document_id:"example.reader/notes/2026/11/source".into(),title:"Selected notes".into(),grant_id:"synthetic-grant".into(),revision:"v1".into()}}
fn source()->SelectedDocument {SelectedDocument {reference:reference(),document_date:"2026-11-26".into(),content:Some("Immutable selected text".into())}}
fn intent()->Intent {Intent {instructions:"Summarize the approved input".into(),sources:vec![reference()],agent_id:"codex".into(),policy_digest:"b".repeat(64),component:Some(runs::ComponentIdentity {protocol_revision:1,sha256:"d".repeat(64)}),output_schema:Some(json!({"type":"object","properties":{"summary":{"type":"string"}}}))}}

#[test]
fn approved_intent_survives_restart_and_exact_replay_without_recapture() {
    let f=Fixture::new(); let first=f.approve("one",&intent()).unwrap();
    let before=fs::read(f.0.join("capability-agent-runs.json")).unwrap();
    let replay=runs::approve(&f.0,&scope(),"one",&intent(),|| Ok(()),|| panic!("must not recapture")).unwrap();
    assert_eq!(json!(first),json!(replay));
    assert_eq!(json!(runs::get(&f.0,&scope(),&first.id,|| Ok(())).unwrap()),json!(first));
    assert_eq!(json!(first.documents),json!([source()])); assert_eq!(first.submission,Submission::Approved);
    assert_eq!(fs::read(f.0.join("capability-agent-runs.json")).unwrap(),before);
}

#[test]
fn submission_claim_is_durable_and_cannot_be_reissued_after_lost_reply() {
    let f=Fixture::new();let approved=f.approve("one",&intent()).unwrap();
    let claimed=runs::claim_submission(&f.0,&scope(),&approved.id,|_| Ok(())).unwrap();
    let Submission::Pending {client_message_id}=&claimed.submission else {panic!("missing dispatch identity")};
    assert_eq!(client_message_id.len(),64);
    assert!(runs::claim_submission(&f.0,&scope(),&approved.id,|_| Ok(())).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
    assert_eq!(json!(f.approve("one",&intent()).unwrap()),json!(claimed));
    assert_eq!(json!(runs::get(&f.0,&scope(),&approved.id,|| Ok(())).unwrap()),json!(claimed));
}

#[test]
fn changed_intent_conflicts_and_other_installations_cannot_read_or_claim() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    for changed in [Intent {instructions:"Different work".into(),..intent()},Intent {agent_id:"other".into(),..intent()},
        Intent {policy_digest:"c".repeat(64),..intent()},Intent {component:Some(runs::ComponentIdentity {protocol_revision:1,sha256:"e".repeat(64)}),..intent()},Intent {sources:vec![],..intent()},Intent {output_schema:None,..intent()}] {
        let error=f.approve("one",&changed).unwrap_err();assert!(error.starts_with("CONFLICT"),"{error}: {changed:?}");
    }
    let mut foreign=scope();foreign.installation.capability_id="example.peer".into();
    let mut replaced=scope();replaced.installation.generation="c".repeat(64);
    let mut updated=scope();updated.installation.capability_version="1.0.1".into();
    for other in [foreign,replaced,updated] {
        assert!(runs::get(&f.0,&other,&first.id,|| Ok(())).is_err());
        assert!(runs::claim_submission(&f.0,&other,&first.id,|_| Ok(())).is_err());
    }
    assert_eq!(runs::get(&f.0,&scope(),&first.id,|| Ok(())).unwrap().submission,Submission::Approved);
}

#[test]
fn revoked_authority_is_checked_for_approval_replay_read_and_dispatch() {
    let f=Fixture::new();let denied=|| Err("PERMISSION_DENIED: Host approval or grant revoked".into());
    assert!(runs::approve(&f.0,&scope(),"one",&intent(),denied,|| panic!("denied source capture")).is_err());
    assert!(!f.0.join("capability-agent-runs.json").exists());
    let first=f.approve("one",&intent()).unwrap();let before=fs::read(f.0.join("capability-agent-runs.json")).unwrap();
    assert!(runs::approve(&f.0,&scope(),"one",&intent(),denied,|| panic!("denied replay capture")).is_err());
    assert!(runs::get(&f.0,&scope(),&first.id,denied).is_err());
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|_|denied()).is_err());
    assert_eq!(fs::read(f.0.join("capability-agent-runs.json")).unwrap(),before);
}

#[test]
fn mismatched_sources_and_failed_writes_leave_no_effect_or_dispatch_claim() {
    let f=Fixture::new();
    for docs in [vec![],vec![SelectedDocument {content:None,..source()}],
        vec![SelectedDocument {reference:DocumentReference {revision:"v2".into(),..reference()},..source()}]] {
        assert!(runs::approve(&f.0,&scope(),"one",&intent(),|| Ok(()),|| Ok(docs)).is_err());
    }
    fs::create_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    assert!(f.approve("one",&intent()).is_err());assert!(!f.0.join("capability-agent-runs.json").exists());
    fs::remove_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    let first=f.approve("one",&intent()).unwrap();
    fs::create_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|_| Ok(())).is_err());
    assert_eq!(runs::get(&f.0,&scope(),&first.id,|| Ok(())).unwrap().submission,Submission::Approved);
    fs::remove_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|_| Ok(())).is_ok());
}

#[test]
fn restored_records_are_retained_but_old_approval_never_becomes_runnable() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    let backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    assert!(backup.files.contains_key("capability-agent-runs.json"));
    runs::claim_submission(&f.0,&scope(),&first.id,|_| Ok(())).unwrap();
    // Roll back to a backup from before the submission claim: it must not resurrect eligibility.
    user_data::restore(&f.0,&backup,"restore-agent-ledger").unwrap();
    let retained:serde_json::Value=serde_json::from_str(&fs::read_to_string(f.0.join("capability-agent-runs.json")).unwrap()).unwrap();
    assert_eq!(retained["runs"][&first.id]["documents"],json!([source()]));
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|_| Ok(())).unwrap_err().contains("restore scope"));
    let current=Scope {restore_id:Some("restore-agent-ledger".into()),..scope()};
    assert!(runs::get(&f.0,&current,&first.id,|| Ok(())).is_err());
    assert!(runs::claim_submission(&f.0,&current,&first.id,|_| Ok(())).is_err());
    let new=runs::approve(&f.0,&current,"one",&intent(),|| Ok(()),|| Ok(vec![source()])).unwrap();
    assert_ne!(new.id,first.id);assert_ne!(new.approval_id,first.approval_id);
}

#[test]
fn forged_restore_scope_cannot_import_execution_authority() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    let mut backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    let mut ledger:serde_json::Value=serde_json::from_str(&backup.files["capability-agent-runs.json"]).unwrap();
    ledger["runs"][&first.id]["scope"]["restoreId"]=json!("predictable-restore");
    backup.files.insert("capability-agent-runs.json".into(),ledger.to_string());
    user_data::restore(&f.0,&backup,"predictable-restore").unwrap();
    let current=Scope {restore_id:Some("predictable-restore".into()),..scope()};
    assert!(runs::claim_submission(&f.0,&current,&first.id,|_| Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
}

#[test]
fn approved_unicode_source_titles_keep_the_existing_character_limit() {
    let f=Fixture::new();let mut selected=source();selected.reference.title="文".repeat(120);
    let input=Intent {sources:vec![selected.reference.clone()],..intent()};
    let approved=runs::approve(&f.0,&scope(),"one",&input,|| Ok(()),|| Ok(vec![selected])).unwrap();
    assert_eq!(approved.documents[0].reference.title.chars().count(),120);
}

#[test]
fn authority_and_capture_are_inside_the_shared_data_transaction() {
    let f=Fixture::new();
    let excluded=|| {
        assert!(user_data::capture(&f.0,Default::default(),json!([])).unwrap_err().contains("changing"));
        assert!(f.approve("other",&intent()).unwrap_err().starts_with("RESOURCE_BUSY"));
        Ok(())
    };
    let first=runs::approve(&f.0,&scope(),"one",&intent(),excluded,|| {excluded()?;Ok(vec![source()])}).unwrap();
    runs::claim_submission(&f.0,&scope(),&first.id,|_|excluded()).unwrap();
}

#[test]
fn full_journal_retains_existing_runs_and_refuses_new_work() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    // Fill the bounded journal without performing 255 unrelated disk transactions.
    let mut ledger:serde_json::Value=serde_json::from_slice(&fs::read(f.0.join("capability-agent-runs.json")).unwrap()).unwrap();
    for n in 1..256 {
        let mut run=json!(first);let id=format!("{n:064x}");
        run["id"]=json!(id);run["approvalId"]=json!(format!("{:064x}",n+256));run["requestKey"]=json!(format!("key-{n}"));
        ledger["runs"].as_object_mut().unwrap().insert(id,run);
    }
    fs::write(f.0.join("capability-agent-runs.json"),ledger.to_string()).unwrap();
    let before=fs::read(f.0.join("capability-agent-runs.json")).unwrap();
    assert_eq!(f.approve("one",&intent()).unwrap().id,first.id);
    assert!(runs::approve(&f.0,&scope(),"new",&intent(),|| Ok(()),|| panic!("full store must not capture")).unwrap_err().starts_with("RESOURCE_LIMIT"));
    assert_eq!(fs::read(f.0.join("capability-agent-runs.json")).unwrap(),before);
}

#[test]
fn interrupted_restore_fails_before_authorization_or_capture() {
    let f=Fixture::new();fs::create_dir(f.0.join(".data-restore")).unwrap();
    fs::write(f.0.join(".data-restore/prepared.json"),"\"unfinished-restore\"").unwrap();
    assert!(runs::approve(&f.0,&scope(),"one",&intent(),|| panic!("restore must fence approval"),|| panic!("restore must fence capture")).unwrap_err().starts_with("RESOURCE_BUSY"));
}

#[test]
fn invalid_or_oversized_input_and_corrupt_disk_are_not_replaced() {
    let f=Fixture::new();
    for input in [Intent {instructions:" ".into(),..intent()},Intent {instructions:"x".repeat(20_001),..intent()},
        Intent {sources:vec![reference(),reference()],..intent()},Intent {policy_digest:"unknown".into(),..intent()},
        Intent {component:Some(runs::ComponentIdentity {protocol_revision:2,sha256:"d".repeat(64)}),..intent()},
        Intent {component:Some(runs::ComponentIdentity {protocol_revision:1,sha256:"invalid".into()}),..intent()},
        Intent {output_schema:Some(json!({"description":"x".repeat(16_384)})),..intent()}] {
        assert!(runs::approve(&f.0,&scope(),"one",&input,|| panic!("invalid approval"),|| panic!("invalid capture")).is_err());
    }
    assert!(runs::approve(&f.0,&scope(),"one",&intent(),|| Ok(()),|| Ok(vec![SelectedDocument {content:Some("x".repeat(8_000_001)),..source()}])).is_err());
    assert!(!f.0.join("capability-agent-runs.json").exists());
    fs::write(f.0.join("capability-agent-runs.json"),"{}").unwrap();assert!(f.approve("one",&intent()).is_err());
    assert_eq!(fs::read_to_string(f.0.join("capability-agent-runs.json")).unwrap(),"{}");
}

#[test]
fn backup_validation_rejects_changed_snapshot_identity_and_submission_identity() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    runs::claim_submission(&f.0,&scope(),&first.id,|_| Ok(())).unwrap();
    let backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    for (pointer,value) in [(format!("/runs/{}/documents/0/reference/revision",first.id),json!("forged")),
        (format!("/runs/{}/submission/clientMessageId",first.id),json!("forged"))] {
        let mut invalid=backup.clone();let mut ledger:serde_json::Value=serde_json::from_str(&backup.files["capability-agent-runs.json"]).unwrap();
        *ledger.pointer_mut(&pointer).unwrap()=value;
        invalid.files.insert("capability-agent-runs.json".into(),ledger.to_string());
        assert!(user_data::validate(&invalid).is_err());
    }
}

#[test]
fn concurrent_processes_obtain_exactly_one_submission_claim() {
    const CHILD:&str="NOOKI_AGENT_LEDGER_CHILD";
    if let Ok(root)=std::env::var(CHILD) {
        let root=PathBuf::from(root);let id=std::env::var("NOOKI_AGENT_LEDGER_ID").unwrap();
        for _ in 0..100 {
            match runs::claim_submission(&root,&scope(),&id,|_| Ok(())) {
                Ok(_)=>{fs::write(root.join(format!("dispatched-{}",std::process::id())),"one").unwrap();return;}
                Err(e) if e.starts_with("RESOURCE_BUSY")=>std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(e)=>{assert!(e.starts_with("OUTCOME_UNKNOWN"),"{e}");return;}
            }
        }
        panic!("claim never settled");
    }
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    let mut children=(0..2).map(|_|std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact","concurrent_processes_obtain_exactly_one_submission_claim","--nocapture"])
        .env(CHILD,&f.0).env("NOOKI_AGENT_LEDGER_ID",&first.id).spawn().unwrap()).collect::<Vec<_>>();
    for child in &mut children {assert!(child.wait().unwrap().success());}
    assert_eq!(fs::read_dir(&f.0).unwrap().filter(|e|e.as_ref().unwrap().file_name().to_string_lossy().starts_with("dispatched-")).count(),1);
    assert!(matches!(runs::get(&f.0,&scope(),&first.id,|| Ok(())).unwrap().submission,Submission::Pending {..}));
}

#[test]
fn approved_run_pins_native_component_before_any_dispatch() {
    let f=Fixture::new();let approved=f.approve("bound",&intent()).unwrap();
    let stored=json!(runs::get(&f.0,&scope(),&approved.id,||Ok(())).unwrap());
    assert_eq!(stored["intent"]["component"]["protocolRevision"],json!(1));
    assert_eq!(stored["intent"]["component"]["sha256"],json!("d".repeat(64)));
}

fn claimed(f:&Fixture,key:&str)->runs::Run {
    let run=f.approve(key,&intent()).unwrap();
    runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap()
}
fn bound(f:&Fixture,run:&runs::Run)->runs::NativeRunBinding {
    runs::native_binding(&f.0,&scope(),&run.id,||Ok(())).unwrap()
}
fn native(thread:&str,turn:Option<&str>)->runs::NativeIdentity {
    runs::NativeIdentity {thread_id:thread.into(),turn_id:turn.map(str::to_owned)}
}
#[test]
fn native_binding_and_identity_survive_lost_replies_without_another_claim() {
    let f=Fixture::new();let approved=f.approve("bound",&intent()).unwrap();
    assert!(runs::native_binding(&f.0,&scope(),&approved.id,||Ok(())).is_err());
    let run=runs::claim_submission(&f.0,&scope(),&approved.id,|_|Ok(())).unwrap();let binding=bound(&f,&run);
    assert_eq!(binding.run_id,run.id);assert_eq!(binding.approval_id,run.approval_id);
    assert_eq!(binding.scope,scope());assert_eq!(binding.policy_digest,run.intent.policy_digest);
    assert_eq!(binding.input_digest.len(),64);assert_eq!(bound(&f,&run),binding);
    assert_eq!(json!(run.submission)["clientMessageId"],binding.client_message_id);
    let created=native("native-thread",None);let started=native("native-thread",Some("native-turn"));
    runs::record_native(&f.0,&scope(),&binding,&created,||Ok(())).unwrap();
    runs::record_native(&f.0,&scope(),&binding,&started,||Ok(())).unwrap();
    let before=fs::read(f.0.join("capability-agent-runs.json")).unwrap();
    // A repeated response or late thread-created response cannot overwrite a known turn.
    for receipt in [&started,&created] {
        assert_eq!(runs::record_native(&f.0,&scope(),&binding,receipt,||Ok(())).unwrap().native,Some(started.clone()));
    }
    assert_eq!(fs::read(f.0.join("capability-agent-runs.json")).unwrap(),before);
    assert_eq!(runs::get(&f.0,&scope(),&run.id,||Ok(())).unwrap().native,Some(started));
    assert!(runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
    for changed in [native("other-thread",Some("native-turn")),native("native-thread",Some("other-turn"))] {
        assert!(runs::record_native(&f.0,&scope(),&binding,&changed,||Ok(())).unwrap_err().starts_with("CONFLICT"));
    }
}

#[test]
fn every_binding_dimension_is_checked_against_the_journal() {
    let f=Fixture::new();let run=claimed(&f,"first");let binding=bound(&f,&run);let other=claimed(&f,"other");
    let mut wrong_scope=binding.scope.clone();wrong_scope.installation.generation="f".repeat(64);
    let changes=[
        runs::NativeRunBinding {run_id:other.id,..binding.clone()},
        runs::NativeRunBinding {scope:wrong_scope,..binding.clone()},
        runs::NativeRunBinding {approval_id:"f".repeat(64),..binding.clone()},
        runs::NativeRunBinding {client_message_id:"f".repeat(64),..binding.clone()},
        runs::NativeRunBinding {input_digest:"f".repeat(64),..binding.clone()},
        runs::NativeRunBinding {policy_digest:"f".repeat(64),..binding.clone()},
        runs::NativeRunBinding {component:runs::ComponentIdentity {protocol_revision:1,sha256:"f".repeat(64)},..binding.clone()},
        runs::NativeRunBinding {component:runs::ComponentIdentity {protocol_revision:2,..binding.component.clone()},..binding.clone()},
    ];
    let before=fs::read(f.0.join("capability-agent-runs.json")).unwrap();
    for changed in changes {
        assert!(runs::record_native(&f.0,&scope(),&changed,&native("thread",Some("turn")),||Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
    }
    assert_eq!(fs::read(f.0.join("capability-agent-runs.json")).unwrap(),before);
}

#[test]
fn native_association_is_fenced_atomic_and_unique_to_one_run() {
    let f=Fixture::new();let one=claimed(&f,"one");let two=claimed(&f,"two");let binding=bound(&f,&one);
    let observed=native("thread",Some("turn"));
    let denied=||Err("PERMISSION_DENIED: installation disabled".into());
    assert!(runs::native_binding(&f.0,&scope(),&one.id,denied).is_err());
    assert!(runs::record_native(&f.0,&scope(),&binding,&observed,denied).is_err());
    fs::create_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    assert!(runs::record_native(&f.0,&scope(),&binding,&observed,||Ok(())).is_err());
    assert!(runs::get(&f.0,&scope(),&one.id,||Ok(())).unwrap().native.is_none());
    fs::remove_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    runs::record_native(&f.0,&scope(),&binding,&observed,|| {
        assert!(user_data::capture(&f.0,Default::default(),json!([])).is_err());
        assert!(runs::record_native(&f.0,&scope(),&binding,&observed,||Ok(())).unwrap_err().starts_with("RESOURCE_BUSY"));Ok(())
    }).unwrap();
    assert!(runs::record_native(&f.0,&scope(),&bound(&f,&two),&observed,||Ok(())).unwrap_err().starts_with("CONFLICT"));
    for invalid in [native("",None),native("thread",Some("\n")),native(&"x".repeat(129),None)] {
        assert!(runs::record_native(&f.0,&scope(),&binding,&invalid,||panic!("invalid input reached authority")).is_err());
    }
}

#[test]
fn native_input_digest_covers_retained_body_instructions_schema_and_agent() {
    let f=Fixture::new();let original=claimed(&f,"one");let digest=bound(&f,&original).input_digest;
    for (n,(input,doc)) in [
        (Intent {instructions:"Changed input".into(),..intent()},source()),
        (Intent {output_schema:None,..intent()},source()),
        (Intent {agent_id:"another-agent".into(),..intent()},source()),
        (intent(),SelectedDocument {content:Some("Different retained body".into()),..source()}),
    ].into_iter().enumerate() {
        let run=runs::approve(&f.0,&scope(),&format!("changed-{n}"),&input,||Ok(()),||Ok(vec![doc])).unwrap();
        runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap();
        assert_ne!(bound(&f,&run).input_digest,digest);
    }
}

#[test]
fn legacy_approvals_are_readable_but_cannot_be_upgraded_into_native_authority() {
    let f=Fixture::new();let run=f.approve("legacy",&intent()).unwrap();let path=f.0.join("capability-agent-runs.json");
    let mut ledger:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    ledger["runs"][&run.id]["intent"].as_object_mut().unwrap().remove("component");fs::write(&path,ledger.to_string()).unwrap();
    let historical=runs::get(&f.0,&scope(),&run.id,||Ok(())).unwrap();assert!(historical.intent.component.is_none());
    assert!(runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap_err().starts_with("UNSUPPORTED_SERVICE"));
    assert!(f.approve("legacy",&intent()).unwrap_err().starts_with("CONFLICT"));
    assert!(f.approve("new-without-component",&historical.intent).unwrap_err().starts_with("UNSUPPORTED_SERVICE"));
    assert_eq!(f.approve("legacy",&historical.intent).unwrap().id,run.id);
    ledger["runs"][&run.id]["submission"]=json!({"state":"pending","clientMessageId":"e".repeat(64)});
    fs::write(&path,ledger.to_string()).unwrap();
    assert!(runs::native_binding(&f.0,&scope(),&run.id,||Ok(())).unwrap_err().starts_with("UNSUPPORTED_SERVICE"));
    assert!(runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
}

#[test]
fn restored_native_bindings_preserve_history_without_recovery_authority() {
    let f=Fixture::new();let run=claimed(&f,"one");let binding=bound(&f,&run);let observed=native("thread",Some("turn"));
    runs::record_native(&f.0,&scope(),&binding,&observed,||Ok(())).unwrap();
    let mut backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    // Even a backup whose scope predicts the upcoming restore is retained-only.
    let mut ledger:serde_json::Value=serde_json::from_str(&backup.files["capability-agent-runs.json"]).unwrap();
    ledger["runs"][&run.id]["scope"]["restoreId"]=json!("bound-restore");
    backup.files.insert("capability-agent-runs.json".into(),ledger.to_string());
    user_data::restore(&f.0,&backup,"bound-restore").unwrap();let current=Scope {restore_id:Some("bound-restore".into()),..scope()};
    assert_eq!(runs::get(&f.0,&current,&run.id,||Ok(())).unwrap().native,Some(observed.clone()));
    assert!(runs::native_binding(&f.0,&current,&run.id,||Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
    let forged=runs::NativeRunBinding {scope:current.clone(),..binding};
    assert!(runs::record_native(&f.0,&current,&forged,&observed,||Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
}

#[test]
fn concurrent_native_receipts_after_restart_cannot_reassign_the_run() {
    const CHILD:&str="NOOKI_AGENT_BINDING_CHILD";
    if let Ok(root)=std::env::var(CHILD) {
        let root=PathBuf::from(root);let id=std::env::var("NOOKI_AGENT_BINDING_ID").unwrap();
        let receipt=native(&format!("thread-{}",std::process::id()),Some("turn"));
        for _ in 0..100 {
            let result=runs::native_binding(&root,&scope(),&id,||Ok(())).and_then(|b|runs::record_native(&root,&scope(),&b,&receipt,||Ok(())));
            match result {
                Ok(run)=>{assert_eq!(run.native,Some(receipt));fs::write(root.join(format!("associated-{}",std::process::id())),"one").unwrap();return;}
                Err(e) if e.starts_with("RESOURCE_BUSY")=>std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(e)=>{assert!(e.starts_with("CONFLICT"),"{e}");return;}
            }
        }
        panic!("native receipt never settled");
    }
    let f=Fixture::new();let run=claimed(&f,"one");
    let mut children=(0..2).map(|_|std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact","concurrent_native_receipts_after_restart_cannot_reassign_the_run","--nocapture"])
        .env(CHILD,&f.0).env("NOOKI_AGENT_BINDING_ID",&run.id).spawn().unwrap()).collect::<Vec<_>>();
    for child in &mut children {assert!(child.wait().unwrap().success());}
    assert_eq!(fs::read_dir(&f.0).unwrap().filter(|e|e.as_ref().unwrap().file_name().to_string_lossy().starts_with("associated-")).count(),1);
    assert_eq!(runs::get(&f.0,&scope(),&run.id,||Ok(())).unwrap().native.unwrap().turn_id,Some("turn".into()));
}

#[test]
fn backup_validation_rejects_duplicate_threads_and_invalid_native_metadata() {
    let f=Fixture::new();let one=claimed(&f,"one");let two=claimed(&f,"two");
    runs::record_native(&f.0,&scope(),&bound(&f,&one),&native("thread",Some("turn")),||Ok(())).unwrap();
    let backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    for (id,field,value) in [
        (&two.id,"native",json!(native("thread",None))),
        (&one.id,"native",json!({"threadId":"","turnId":"turn"})),
        (&one.id,"submission",json!({"state":"approved"})),
    ] {
        let mut corrupted=backup.clone();let mut ledger:serde_json::Value=serde_json::from_str(&backup.files["capability-agent-runs.json"]).unwrap();
        ledger["runs"][id][field]=value;corrupted.files.insert("capability-agent-runs.json".into(),ledger.to_string());
        assert!(user_data::validate(&corrupted).is_err());
    }
}

#[test]
fn native_launch_input_is_exact_retained_serialization_and_does_not_reclaim() {
    use sha2::{Digest,Sha256};
    let f=Fixture::new();let mut input=intent();
    input.instructions="nooki-native-model-probe: summarize approved Unicode \u{4f1a}\u{8bae} notes".into();
    if let Ok(sha)=std::env::var("NOOKI_NATIVE_INPUT_COMPONENT_SHA") {input.component.as_mut().unwrap().sha256=sha;}
    let doc=SelectedDocument {content:Some("Retained body: quoted \"text\", newline\n\u{4f60}\u{597d} 🧰".into()),..source()};
    let doc=if std::env::var("NOOKI_NATIVE_INPUT_LARGE").as_deref()==Ok("1") {
        SelectedDocument {content:Some("Retained body: ".to_owned()+&"x".repeat(1_100_000)),..doc}
    } else {doc};
    let run=runs::approve(&f.0,&scope(),"native-input",&input,||Ok(()),||Ok(vec![doc])).unwrap();
    assert!(runs::native_launch_input(&f.0,&scope(),&run.id,||Ok(())).is_err());
    let run=runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap();
    let before=fs::read(f.0.join("capability-agent-runs.json")).unwrap();
    let launch=runs::native_launch_input(&f.0,&scope(),&run.id,||Ok(())).unwrap();
    assert_eq!(launch.binding,bound(&f,&run));
    assert_eq!(format!("{:x}",Sha256::digest(launch.input_json.as_bytes())),launch.binding.input_digest);
    let material:serde_json::Value=serde_json::from_str(&launch.input_json).unwrap();
    assert_eq!(material,json!(["nooki-agent-input-v1",input.instructions,run.documents,input.output_schema,input.agent_id]));
    assert_eq!(runs::native_launch_input(&f.0,&scope(),&run.id,||Ok(())).unwrap().input_json,launch.input_json);
    assert_eq!(fs::read(f.0.join("capability-agent-runs.json")).unwrap(),before);
    assert!(runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).is_err());
    if let Ok(path)=std::env::var("NOOKI_NATIVE_INPUT_FIXTURE") {
        fs::write(path,serde_json::to_vec(&launch).unwrap()).unwrap();
    }
}

#[test]
fn native_launch_input_obeys_authority_and_import_fences() {
    let f=Fixture::new();let run=claimed(&f,"input");
    assert!(runs::native_launch_input(&f.0,&scope(),&run.id,||Err("PERMISSION_DENIED: revoked".into())).is_err());
    let mut other=scope();other.installation.generation="e".repeat(64);
    assert!(runs::native_launch_input(&f.0,&other,&run.id,||Ok(())).is_err());
    let path=f.0.join("capability-agent-runs.json");
    let mut ledger:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    ledger["runs"][&run.id]["restored"]=json!(true);fs::write(path,ledger.to_string()).unwrap();
    assert!(runs::native_launch_input(&f.0,&scope(),&run.id,||Ok(())).is_err());
}

#[test]
fn native_launch_input_preserves_full_eight_mb_document_without_truncation() {
    let f=Fixture::new();let mut input=intent();
    input.instructions="nooki-native-model-probe: read the complete approved source file".into();
    if let Ok(sha)=std::env::var("NOOKI_NATIVE_INPUT_COMPONENT_SHA") {input.component.as_mut().unwrap().sha256=sha;}
    let prefix="Retained body: \u{4f60}\u{597d}\n";let suffix="\nNOOKI_FULL_SOURCE_END 🧰";
    let body=prefix.to_owned()+&"x".repeat(8_000_000-prefix.len()-suffix.len())+suffix;
    assert_eq!(body.len(),8_000_000);
    let doc=SelectedDocument {content:Some(body.clone()),..source()};
    let run=runs::approve(&f.0,&scope(),"full-input",&input,||Ok(()),||Ok(vec![doc])).unwrap();
    runs::claim_submission(&f.0,&scope(),&run.id,|_|Ok(())).unwrap();
    let launch=runs::native_launch_input(&f.0,&scope(),&run.id,||Ok(())).unwrap();
    let material:serde_json::Value=serde_json::from_str(&launch.input_json).unwrap();
    assert_eq!(material[2][0]["content"],body);
    if let Ok(path)=std::env::var("NOOKI_NATIVE_FULL_INPUT_FIXTURE") {fs::write(path,serde_json::to_vec(&launch).unwrap()).unwrap();}
    let other=Fixture::new();let too_large=SelectedDocument {content:Some(body+"x"),..source()};
    assert!(runs::approve(&other.0,&scope(),"too-large",&input,||Ok(()),||Ok(vec![too_large])).is_err());
    assert!(!other.0.join("capability-agent-runs.json").exists());
}

#[test]
fn completed_native_result_survives_reload_and_cannot_be_replaced_or_reexecuted() {
    let f=Fixture::new();let approved=f.approve("result",&intent()).unwrap();
    runs::claim_submission(&f.0,&scope(),&approved.id,|_|Ok(())).unwrap();
    let binding=runs::native_binding(&f.0,&scope(),&approved.id,||Ok(())).unwrap();
    let native=runs::NativeIdentity{thread_id:"native-thread".into(),turn_id:Some("native-turn".into())};
    runs::record_native(&f.0,&scope(),&binding,&native,||Ok(())).unwrap();
    let outcome=runs::Outcome::Completed{text:"Meeting notes ready".into()};
    runs::record_outcome(&f.0,&scope(),&binding,&native,&outcome,||Ok(())).unwrap();
    assert_eq!(runs::get(&f.0,&scope(),&approved.id,||Ok(())).unwrap().outcome,Some(outcome.clone()));
    runs::record_outcome(&f.0,&scope(),&binding,&native,&outcome,||Ok(())).unwrap();
    assert!(runs::record_outcome(&f.0,&scope(),&binding,&native,&runs::Outcome::Cancelled,||Ok(())).is_err());
    assert!(runs::claim_submission(&f.0,&scope(),&approved.id,|_|Ok(())).is_err());
}

#[test]
fn foreign_or_unbound_native_results_cannot_complete_a_run() {
    let f=Fixture::new();let approved=f.approve("result",&intent()).unwrap();
    runs::claim_submission(&f.0,&scope(),&approved.id,|_|Ok(())).unwrap();
    let binding=runs::native_binding(&f.0,&scope(),&approved.id,||Ok(())).unwrap();
    let native=runs::NativeIdentity{thread_id:"native-thread".into(),turn_id:Some("native-turn".into())};
    let outcome=runs::Outcome::Completed{text:"Meeting notes ready".into()};
    assert!(runs::record_outcome(&f.0,&scope(),&binding,&native,&outcome,||Ok(())).is_err());
    runs::record_native(&f.0,&scope(),&binding,&native,||Ok(())).unwrap();
    let foreign=runs::NativeIdentity{turn_id:Some("foreign-turn".into()),..native.clone()};
    assert!(runs::record_outcome(&f.0,&scope(),&binding,&foreign,&outcome,||Ok(())).is_err());
    assert!(runs::record_outcome(&f.0,&scope(),&binding,&native,&outcome,||Err("PERMISSION_DENIED".into())).is_err());
    assert_eq!(runs::get(&f.0,&scope(),&approved.id,||Ok(())).unwrap().outcome,None);
}
