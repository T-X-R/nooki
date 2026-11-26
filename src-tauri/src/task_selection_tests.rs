use super::*;
use crate::{capability_runtime::{CapabilityManifest, PlatformState}, user_data};
use serde_json::json;
use std::{fs, path::PathBuf};

struct Fixture { root: PathBuf, state: PlatformState }
impl Fixture {
    fn new() -> Self {
        let root=std::env::temp_dir().join(format!("nooki-task-selection-{}",crate::capability_authority::nonce().unwrap()));
        let state=PlatformState::load(root.clone()).unwrap();
        for id in ["example.reader","example.peer"] {
            let manifest: CapabilityManifest=serde_json::from_value(json!({"id":id,"name":id,"version":"1.0.0","description":"","entrypoints":["page"],"permissions":["board.attach-delivery"],"minPlatformVersion":"0.8.0"})).unwrap();
            state.install_capability(manifest).unwrap();
        }
        state.write_task_board(&json!({"cards":[{"id":"first","title":"User task","description":"Private description","status":"todo"},{"id":"second","title":"Other task","description":"Other private data","status":"todo"}]})).unwrap();
        Self { root,state }
    }
    fn request(&self, id: &str) -> Value { json!({"requestId":id,"capabilityId":"example.reader","version":"1.0.0","purpose":"Attach reviewed notes","operations":["attachDelivery"],"limit":1}) }
    fn begin(&self, id: &str) -> Value { begin(&self.state,"main",self.request(id)).unwrap() }
    fn approved(&self, ticket: &Value) -> Value { json!({"handle":ticket["handle"],"items":[{"id":"first","revision":1}]}) }
    fn board(&self) -> Value { self.state.read_task_board().unwrap() }
}
impl Drop for Fixture { fn drop(&mut self) { let _=fs::remove_dir_all(&self.root); } }

#[test]
fn approval_is_host_owned_metadata_only_and_idempotent() {
    let f=Fixture::new(); let initial=f.board();
    assert!(begin(&f.state,"package",f.request("foreign")).unwrap_err().starts_with("PERMISSION_DENIED"));
    let ticket=f.begin("approved");
    assert_eq!(f.begin("approved"),ticket);
    assert_eq!(f.board(),initial);
    assert!(ticket.get("generation").is_none());
    let grant=commit(&f.state,"main",f.approved(&ticket)).unwrap();
    assert_eq!(grant["items"][0],json!({"id":"first","title":"User task","revision":1}));
    assert_eq!(grant["operations"],json!(["attachDelivery"]));
    assert!(!grant.to_string().contains("Private description"));
    assert_eq!(commit(&f.state,"main",f.approved(&ticket)).unwrap(),grant);
    assert_eq!(f.board()["cards"],initial["cards"]);
    cancel(&f.state,"main",json!({"requestId":"approved"})).unwrap();
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap()[0]["status"],"active");
}

#[test]
fn dismissal_and_stale_display_do_not_grant_authority() {
    let f=Fixture::new(); let ticket=f.begin("cancelled");
    cancel(&f.state,"main",json!({"requestId":"cancelled"})).unwrap();
    assert!(commit(&f.state,"main",f.approved(&ticket)).is_err());
    let ticket=f.begin("stale");let mut board=f.board();board["cards"][0]["title"]=json!("Changed by user");f.state.write_task_board(&board).unwrap();
    let before=f.board();
    assert!(commit(&f.state,"main",f.approved(&ticket)).unwrap_err().starts_with("CONFLICT"));
    assert_eq!(f.board(),before);
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap(),json!([]));
}

#[test]
fn failed_commit_binds_the_approved_selection_and_retry_creates_one_grant() {
    let f=Fixture::new();let ticket=f.begin("retry");let before=fs::read(f.root.join("task-board.json")).unwrap();
    fs::create_dir(f.root.join("task-board.pending")).unwrap();
    assert!(commit(&f.state,"main",f.approved(&ticket)).is_err());
    assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);
    fs::remove_dir(f.root.join("task-board.pending")).unwrap();
    assert!(commit(&f.state,"main",json!({"handle":ticket["handle"],"items":[{"id":"second","revision":2}]})).unwrap_err().starts_with("CONFLICT"));
    let grant=commit(&f.state,"main",f.approved(&ticket)).unwrap();
    assert_eq!(commit(&f.state,"main",f.approved(&ticket)).unwrap(),grant);
    let mut renderer=f.board();renderer["taskGrants"]=json!({"forged":{}});f.state.write_task_board(&renderer).unwrap();
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap().as_array().unwrap().len(),1);
}

#[test]
fn restart_retains_grants_and_revocation_cannot_be_undone_by_restore() {
    let f=Fixture::new();let ticket=f.begin("durable");let grant=commit(&f.state,"main",f.approved(&ticket)).unwrap();
    let backup=user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    let restarted=PlatformState::load(f.root.clone()).unwrap();
    assert_eq!(accesses(&restarted,"main",json!({})).unwrap()[0]["status"],"active");
    revoke(&restarted,"main",json!({"id":grant["id"]})).unwrap();
    assert_eq!(accesses(&restarted,"main",json!({})).unwrap()[0]["status"],"revoked");
    user_data::restore(&f.root,&backup,"restore-task-grants").unwrap();
    assert_eq!(accesses(&restarted,"main",json!({})).unwrap()[0]["status"],"inactive");
    assert!(commit(&f.state,"main",f.approved(&ticket)).is_err());
}

#[test]
fn lifecycle_changes_invalidate_pending_and_committed_grants() {
    let f=Fixture::new();let ticket=f.begin("committed");commit(&f.state,"main",f.approved(&ticket)).unwrap();
    let pending=f.begin("pending");
    f.state.set_capability_enabled("example.reader",false).unwrap();f.state.set_capability_enabled("example.reader",true).unwrap();
    assert!(commit(&f.state,"main",f.approved(&pending)).unwrap_err().starts_with("PERMISSION_DENIED"));
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap()[0]["status"],"inactive");
}

#[test]
fn effect_scope_rejects_foreign_operations_and_stale_tasks_without_changing_data() {
    let f=Fixture::new();let ticket=f.begin("scope");let grant=commit(&f.state,"main",f.approved(&ticket)).unwrap();
    let id=grant["id"].as_str().unwrap();
    let check=|owner:&str,item:Item,op:&str| {
        let _data=crate::task_worker::data_lock(&f.root).unwrap().unwrap();
        let _fence=crate::capability_authority::fence(&f.root).unwrap();
        authorize(&f.root,&crate::task_goals::load(&f.root).unwrap(),&context(&f.root,owner).unwrap(),id,&item,op)
    };
    assert!(check("example.reader",Item{id:"first".into(),revision:1},OPERATION).is_ok());
    for op in ["accept","delegate","read","update"] {
        assert!(check("example.reader",Item{id:"first".into(),revision:1},op).unwrap_err().starts_with("PERMISSION_DENIED"));
    }
    assert!(check("example.peer",Item{id:"first".into(),revision:1},OPERATION).is_err());
    assert!(check("example.reader",Item{id:"second".into(),revision:2},OPERATION).is_err());
    assert!(check("example.reader",Item{id:"first".into(),revision:999},OPERATION).is_err());
    let mut board=f.board();board["cards"][1]["title"]=json!("Unrelated edit");f.state.write_task_board(&board).unwrap();
    assert!(check("example.reader",Item{id:"first".into(),revision:1},OPERATION).is_ok());
    let mut board=f.board();board["cards"][0]["title"]=json!("Selected task edited");f.state.write_task_board(&board).unwrap();
    let before=fs::read(f.root.join("task-board.json")).unwrap();
    assert!(check("example.reader",Item{id:"first".into(),revision:1},OPERATION).unwrap_err().starts_with("CONFLICT"));
    assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap()[0]["status"],"stale");
    assert_eq!(commit(&f.state,"main",f.approved(&ticket)).unwrap(),grant);
    revoke(&f.state,"main",json!({"id":id})).unwrap();
    assert!(check("example.reader",Item{id:"first".into(),revision:1},OPERATION).unwrap_err().starts_with("PERMISSION_DENIED"));
}

#[test]
fn malformed_requests_and_expired_sessions_never_commit_a_grant() {
    let f=Fixture::new();
    for (field,value) in [("operations",json!(["accept"])),("operations",json!(["attachDelivery","delegate"])),("limit",json!(0)),("limit",json!(51)),("purpose",json!("  ")),("generation",json!("forged"))] {
        let mut input=f.request("invalid");input[field]=value;assert!(begin(&f.state,"main",input).is_err());
    }
    let ticket=f.begin("objects");
    for items in [json!([["first",1]]),json!([{"id":"first","revision":1,"status":"done"}]),json!([{"id":"first","revision":0}]),json!([{"id":"first","revision":1},{"id":"first","revision":1}])] {
        assert!(commit(&f.state,"main",json!({"handle":ticket["handle"],"items":items})).is_err());
    }
    f.state.task_selections.lock().unwrap().get_mut(ticket["handle"].as_str().unwrap()).unwrap().expires_at=Instant::now();
    assert!(commit(&f.state,"main",f.approved(&ticket)).is_err());
    assert!(f.state.task_selections.lock().unwrap().is_empty());
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap(),json!([]));
}

#[test]
fn restore_recovery_and_foreign_backups_cannot_revive_grants() {
    let f=Fixture::new();let ticket=f.begin("before-restore");commit(&f.state,"main",f.approved(&ticket)).unwrap();
    let backup=user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    assert!(!backup.files.contains_key(EPOCH_FILE));
    let old_epoch=epoch(&f.root).unwrap();
    let directory=f.root.join(".data-restore");fs::create_dir_all(directory.join("previous")).unwrap();
    for (name,content) in &backup.files {
        let path=directory.join("previous").join(name);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,content).unwrap();
    }
    fs::write(directory.join("prepared.json"),b"\"interrupted\"").unwrap();
    assert!(accesses(&f.state,"main",json!({})).unwrap_err().starts_with("RESOURCE_BUSY"));
    user_data::recover(&f.root).unwrap();
    assert_ne!(epoch(&f.root).unwrap(),old_epoch);
    assert_eq!(accesses(&f.state,"main",json!({})).unwrap()[0]["status"],"inactive");
    let other=Fixture::new();user_data::restore(&other.root,&backup,"foreign-backup").unwrap();
    assert_eq!(accesses(&other.state,"main",json!({})).unwrap()[0]["status"],"inactive");
}

#[test]
fn grant_capacity_preserves_existing_records_and_invalid_backups_fail_validation() {
    let f=Fixture::new();let ticket=f.begin("capacity");let grant=commit(&f.state,"main",f.approved(&ticket)).unwrap();
    let mut board=f.board();let original=board["taskGrants"][grant["id"].as_str().unwrap()].clone();
    let records=(0..MAX_PACKAGE_GRANTS).map(|n|(format!("{n:064x}"),original.clone())).collect::<serde_json::Map<_,_>>();
    board["taskGrants"]=json!(records);fs::write(f.root.join("task-board.json"),serde_json::to_vec(&board).unwrap()).unwrap();
    let ticket=f.begin("full");let before=fs::read(f.root.join("task-board.json")).unwrap();
    assert!(commit(&f.state,"main",f.approved(&ticket)).unwrap_err().starts_with("RESOURCE_LIMIT"));
    assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);
    let mut backup=user_data::capture(&f.root,Default::default(),json!([])).unwrap();
    board["taskGrants"][format!("{:064x}",0)]["items"]=json!([["first",1,"User task"]]);
    backup.files.insert("task-board.json".into(),board.to_string());
    assert!(user_data::validate(&backup).is_err());
}

#[test]
fn update_reinstall_and_permission_removal_invalidate_grants_and_pending_approval() {
    for change in ["update","reinstall","permission"] {
        let f=Fixture::new();let ticket=f.begin("approved");commit(&f.state,"main",f.approved(&ticket)).unwrap();
        let pending=f.begin("pending");
        if change=="reinstall" { f.state.uninstall_capability("example.reader").unwrap(); }
        let manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.reader","name":"Reader","version":if change=="update" {"2.0.0"} else {"1.0.0"},"description":"","entrypoints":["page"],"permissions":if change=="permission" {json!([])} else {json!(["board.attach-delivery"])},"minPlatformVersion":"0.8.0"})).unwrap();
        if change=="reinstall" { f.state.install_capability(manifest).unwrap(); }
        else { f.state.update_capability(manifest).unwrap(); }
        let before=fs::read(f.root.join("task-board.json")).unwrap();
        assert!(commit(&f.state,"main",f.approved(&pending)).unwrap_err().starts_with("PERMISSION_DENIED"));
        assert_eq!(accesses(&f.state,"main",json!({})).unwrap()[0]["status"],"inactive");
        assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);
        if change=="permission" { assert!(begin(&f.state,"main",f.request("no-permission")).unwrap_err().starts_with("PERMISSION_DENIED")); }
    }
}

#[test]
fn data_maintenance_and_pending_capacity_fail_without_task_effects() {
    let f=Fixture::new();let ticket=f.begin("first");let before=fs::read(f.root.join("task-board.json")).unwrap();
    let lock=crate::task_worker::data_lock(&f.root).unwrap().unwrap();
    assert!(commit(&f.state,"main",f.approved(&ticket)).unwrap_err().starts_with("RESOURCE_BUSY"));
    assert!(accesses(&f.state,"main",json!({})).unwrap_err().starts_with("RESOURCE_BUSY"));
    assert!(revoke(&f.state,"main",json!({"id":"unknown"})).unwrap_err().starts_with("RESOURCE_BUSY"));
    assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);drop(lock);
    for index in 1..16 { f.begin(&format!("pending-{index}")); }
    assert!(begin(&f.state,"main",f.request("overflow")).unwrap_err().starts_with("RESOURCE_LIMIT"));
    cancel(&f.state,"main",json!({"requestId":"first"})).unwrap();f.begin("replacement");
    assert_eq!(fs::read(f.root.join("task-board.json")).unwrap(),before);
}

#[test]
fn public_task_permission_requires_the_supported_platform_version() {
    let f=Fixture::new();
    let mut manifest:CapabilityManifest=serde_json::from_value(json!({"id":"example.floor","name":"Floor","version":"1.0.0","description":"","entrypoints":["page"],"permissions":["board.attach-delivery"],"minPlatformVersion":"0.7.0"})).unwrap();
    assert!(f.state.install_capability(manifest.clone()).unwrap_err().contains("0.8.0"));
    manifest.min_platform_version="0.8.0".into();f.state.install_capability(manifest).unwrap();
}
