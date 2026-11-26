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
fn intent()->Intent {Intent {instructions:"Summarize the approved input".into(),sources:vec![reference()],agent_id:"codex".into(),policy_digest:"b".repeat(64),output_schema:Some(json!({"type":"object","properties":{"summary":{"type":"string"}}}))}}

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
    let claimed=runs::claim_submission(&f.0,&scope(),&approved.id,|| Ok(())).unwrap();
    let Submission::Pending {client_message_id}=&claimed.submission else {panic!("missing dispatch identity")};
    assert_eq!(client_message_id.len(),64);
    assert!(runs::claim_submission(&f.0,&scope(),&approved.id,|| Ok(())).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
    assert_eq!(json!(f.approve("one",&intent()).unwrap()),json!(claimed));
    assert_eq!(json!(runs::get(&f.0,&scope(),&approved.id,|| Ok(())).unwrap()),json!(claimed));
}

#[test]
fn changed_intent_conflicts_and_other_installations_cannot_read_or_claim() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    for changed in [Intent {instructions:"Different work".into(),..intent()},Intent {agent_id:"other".into(),..intent()},
        Intent {policy_digest:"c".repeat(64),..intent()},Intent {sources:vec![],..intent()},Intent {output_schema:None,..intent()}] {
        assert!(f.approve("one",&changed).unwrap_err().starts_with("CONFLICT"));
    }
    let mut foreign=scope();foreign.installation.capability_id="example.peer".into();
    let mut replaced=scope();replaced.installation.generation="c".repeat(64);
    let mut updated=scope();updated.installation.capability_version="1.0.1".into();
    for other in [foreign,replaced,updated] {
        assert!(runs::get(&f.0,&other,&first.id,|| Ok(())).is_err());
        assert!(runs::claim_submission(&f.0,&other,&first.id,|| Ok(())).is_err());
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
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,denied).is_err());
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
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|| Ok(())).is_err());
    assert_eq!(runs::get(&f.0,&scope(),&first.id,|| Ok(())).unwrap().submission,Submission::Approved);
    fs::remove_dir(f.0.join("capability-agent-runs.pending")).unwrap();
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|| Ok(())).is_ok());
}

#[test]
fn restored_records_are_retained_but_old_approval_never_becomes_runnable() {
    let f=Fixture::new();let first=f.approve("one",&intent()).unwrap();
    let backup=user_data::capture(&f.0,Default::default(),json!([])).unwrap();
    assert!(backup.files.contains_key("capability-agent-runs.json"));
    runs::claim_submission(&f.0,&scope(),&first.id,|| Ok(())).unwrap();
    // Roll back to a backup from before the submission claim: it must not resurrect eligibility.
    user_data::restore(&f.0,&backup,"restore-agent-ledger").unwrap();
    let retained:serde_json::Value=serde_json::from_str(&fs::read_to_string(f.0.join("capability-agent-runs.json")).unwrap()).unwrap();
    assert_eq!(retained["runs"][&first.id]["documents"],json!([source()]));
    assert!(runs::claim_submission(&f.0,&scope(),&first.id,|| Ok(())).unwrap_err().contains("restore scope"));
    let current=Scope {restore_id:Some("restore-agent-ledger".into()),..scope()};
    assert!(runs::get(&f.0,&current,&first.id,|| Ok(())).is_err());
    assert!(runs::claim_submission(&f.0,&current,&first.id,|| Ok(())).is_err());
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
    assert!(runs::claim_submission(&f.0,&current,&first.id,|| Ok(())).unwrap_err().starts_with("PERMISSION_DENIED"));
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
    runs::claim_submission(&f.0,&scope(),&first.id,excluded).unwrap();
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
    runs::claim_submission(&f.0,&scope(),&first.id,|| Ok(())).unwrap();
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
            match runs::claim_submission(&root,&scope(),&id,|| Ok(())) {
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
