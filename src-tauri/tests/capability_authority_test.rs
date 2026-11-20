use app_lib::capability_runtime::{CapabilityEntrypoint, CapabilityManifest, CapabilityPermission, PlatformState};
use std::{collections::BTreeMap, fs, path::PathBuf, sync::{Arc, atomic::{AtomicU64, Ordering}, mpsc}, time::Duration};

fn fixture() -> (PathBuf, PlatformState) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!("nooki-authority-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let state = PlatformState::load(root.clone()).unwrap();
    state.install_capability(manifest()).unwrap();
    (root, state)
}
fn manifest() -> CapabilityManifest {
    CapabilityManifest { id:"example.notes".into(), version:"0.1.0".into(), name:"Notes".into(), description:String::new(), locales:BTreeMap::new(), entrypoints:vec![CapabilityEntrypoint::Page], permissions:vec![CapabilityPermission::BoardCreate], min_platform_version:"0.1.0".into() }
}
fn issue(state: &PlatformState) -> String { state.grant_board_creation("native-a", "example.notes", "0.1.0").unwrap() }

#[test]
fn legacy_host_controller_is_main_only_strict_and_releases_native_authority() {
    use app_lib::capability_host::{board_begin,board_release};
    use serde_json::json;
    let (root,state)=fixture();
    let request=json!({"capabilityId":"example.notes","version":"0.1.0"});
    assert!(board_begin(&state,"package-view",request.clone()).is_err());
    for field in ["caller","permissions","generation","handle"] {
        let mut forged=request.clone();forged[field]=json!("forged");
        assert!(board_begin(&state,"main",forged).is_err());
    }
    let handle=board_begin(&state,"main",request.clone()).unwrap();
    state.with_board_authority("main",&handle,"board.create","board",|_|Ok(())).unwrap();
    assert!(board_release(&state,"foreign",json!({"handle":handle})).is_err());
    board_release(&state,"main",json!({"handle":handle})).unwrap();
    assert!(state.with_board_authority("main",&handle,"board.create","board",|_|Ok(())).is_err());
    state.set_capability_enabled("example.notes",false).unwrap();
    assert!(board_begin(&state,"main",request).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn controller_cannot_grant_board_creation_without_manifest_permission() {
    let (root, state) = fixture();
    let mut package = manifest(); package.permissions.clear();
    state.update_capability(package).unwrap();
    let before = fs::read(root.join("capability-invocations.json")).unwrap();
    assert!(state.grant_board_creation("native-a", "example.notes", "0.1.0")
        .unwrap_err().starts_with("PERMISSION_DENIED:"));
    assert_eq!(fs::read(root.join("capability-invocations.json")).unwrap(), before);
    fs::remove_dir_all(root).unwrap();
}
fn read(state: &PlatformState, handle: &str) -> Result<app_lib::capability_authority::InvocationContext, String> {
    state.with_board_authority("native-a", handle, "board.create", "board", |context| Ok(context.clone()))
}

#[test]
fn native_owner_scope_and_unknown_handles_fail_before_the_effect() {
    let (root, state) = fixture();
    let handle = issue(&state);
    let context = read(&state, &handle).unwrap();
    assert_eq!(context.capability_id, "example.notes");
    assert_eq!(context.capability_version, "0.1.0");
    assert!(!context.generation.is_empty());
    for (caller, token, operation, resource) in [
        ("native-b", handle.as_str(), "board.create", "board"),
        ("native-a", "forged", "board.create", "board"),
        ("native-a", handle.as_str(), "board.delegate", "board"),
        ("native-a", handle.as_str(), "board.create", "another-board"),
    ] {
        let error = state.with_board_authority(caller, token, operation, resource, |_| -> Result<(), String> { panic!("denied effect ran") }).unwrap_err();
        assert!(error.contains("PERMISSION_DENIED"));
    }
    assert!(state.grant_board_creation("native-a", "missing", "0.1.0").is_err());
    assert!(state.grant_board_creation("native-a", "example.notes", "wrong-version").is_err());
    assert!(state.revoke_board_invocation("native-b", &handle).is_err());
    read(&state, &handle).unwrap();
    state.revoke_board_invocation("native-a", &handle).unwrap();
    assert!(read(&state, &handle).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn lifecycle_changes_and_restart_never_revive_old_handles() {
    let (root, state) = fixture();
    let first = issue(&state); let generation = read(&state, &first).unwrap().generation;
    state.set_capability_enabled("example.notes", false).unwrap();
    assert!(read(&state, &first).is_err());
    assert!(state.grant_board_creation("native-a", "example.notes", "0.1.0").is_err());
    state.set_capability_enabled("example.notes", true).unwrap();
    assert!(read(&state, &first).is_err());
    let second = issue(&state);
    assert_ne!(read(&state, &second).unwrap().generation, generation);
    state.update_capability(manifest()).unwrap();
    assert!(read(&state, &second).is_err());
    let third = issue(&state);
    state.uninstall_capability("example.notes").unwrap();
    state.install_capability(manifest()).unwrap();
    assert!(read(&state, &third).is_err());
    let fourth = issue(&state); let persisted = read(&state, &fourth).unwrap().generation;
    drop(state);
    let state = PlatformState::load(root.clone()).unwrap();
    assert!(read(&state, &fourth).is_err());
    let fifth = issue(&state);
    assert_ne!(fourth, fifth);
    assert_eq!(read(&state, &fifth).unwrap().generation, persisted);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn authority_capacity_is_returned_by_revocation() {
    let (root, state) = fixture();
    let handles: Vec<_> = (0..16).map(|_| issue(&state)).collect();
    assert!(state.grant_board_creation("native-a", "example.notes", "0.1.0").unwrap_err().contains("LIMIT"));
    state.revoke_board_invocation("native-a", &handles[0]).unwrap();
    read(&state, &issue(&state)).unwrap();
    state.set_capability_enabled("example.notes", false).unwrap();
    state.set_capability_enabled("example.notes", true).unwrap();
    for _ in 0..16 { issue(&state); }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn revocation_and_disable_wait_for_admitted_effect_then_prevent_late_effects() {
  for disable in [false, true] {
    let (root, state) = fixture(); let state = Arc::new(state); let handle = issue(&state);
    let (entered_tx, entered_rx) = mpsc::channel(); let (release_tx, release_rx) = mpsc::channel();
    let effect_state = state.clone(); let effect_handle = handle.clone();
    let effect = std::thread::spawn(move || effect_state.with_board_authority("native-a", &effect_handle, "board.create", "board", |_| {
        entered_tx.send(()).unwrap(); release_rx.recv().unwrap(); Ok(())
    }));
    entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let (started_tx, started_rx) = mpsc::channel(); let (done_tx, done_rx) = mpsc::channel(); let revoke_state = state.clone(); let revoke_handle = handle.clone();
    let revoke = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        let result = if disable { revoke_state.set_capability_enabled("example.notes", false) }
            else { revoke_state.revoke_board_invocation("native-a", &revoke_handle) };
        done_tx.send(result).unwrap();
    });
    started_rx.recv().unwrap();
    assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());
    release_tx.send(()).unwrap(); effect.join().unwrap().unwrap();
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap(); revoke.join().unwrap();
    assert!(state.with_board_authority("native-a", &handle, "board.create", "board", |_| -> Result<(), String> { panic!("late effect ran") }).is_err());
    fs::remove_dir_all(root).unwrap();
  }
}

#[test]
fn failed_registry_commit_keeps_the_live_generation_and_handle() {
    let (root, state) = fixture(); let handle = issue(&state);
    let previous = read(&state, &handle).unwrap();
    let path = root.join("installed-capabilities/capability-registry.json");
    let disk = fs::read(&path).unwrap();
    fs::create_dir(path.with_extension("json.tmp")).unwrap();
    assert!(state.set_capability_enabled("example.notes", false).is_err());
    assert_eq!(read(&state, &handle).unwrap(), previous);
    assert_eq!(fs::read(path).unwrap(), disk);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn external_replacement_and_rollback_invalidate_authority() {
    use app_lib::package_installer::PackagePayload;
    let (root, state) = fixture();
    state.uninstall_capability("example.notes").unwrap();
    let package = |version: &str| { let mut manifest = manifest(); manifest.version = version.into(); PackagePayload { manifest, entry:"synthetic".into(), styles:String::new() } };
    state.activate_package(package("0.1.0"), None, false).unwrap();
    let before = issue(&state);
    state.activate_package(package("0.2.0"), Some("0.1.0".into()), false).unwrap();
    assert!(read(&state, &before).is_err());
    let updated = state.grant_board_creation("native-a", "example.notes", "0.2.0").unwrap();
    state.activate_package(package("0.1.0"), Some("0.2.0".into()), true).unwrap();
    assert!(read(&state, &before).is_err());
    assert!(read(&state, &updated).is_err());
    read(&state, &issue(&state)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_registry_gets_a_generation_without_restoring_an_invocation() {
    let (root, state) = fixture(); drop(state);
    let path = root.join("installed-capabilities/capability-registry.json");
    let mut registry: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    registry.as_object_mut().unwrap().remove("generations");
    fs::write(&path, serde_json::to_vec(&registry).unwrap()).unwrap();
    let state = PlatformState::load(root.clone()).unwrap();
    let handle = issue(&state);
    let context = read(&state, &handle).unwrap();
    let disk: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(disk["generations"]["example.notes"], context.generation);
    assert!(state.with_board_authority("native-a", &handle, "board.create", "board", |_| Err::<(), _>("synthetic effect failed".into())).is_err());
    read(&state, &handle).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn aggregate_capacity_and_invalidation_are_package_scoped() {
    let (root, state) = fixture();
    let mut retained = Vec::new();
    for index in 0..16 {
        let mut package = manifest(); package.id = format!("example.owner{index}");
        state.install_capability(package.clone()).unwrap();
        for _ in 0..16 { retained.push(state.grant_board_creation("native-a", &package.id, "0.1.0").unwrap()); }
    }
    assert!(state.grant_board_creation("native-a", "example.notes", "0.1.0").unwrap_err().contains("LIMIT"));
    state.set_capability_enabled("example.owner0", false).unwrap();
    for handle in &retained[..16] { assert!(read(&state, handle).is_err()); }
    for handle in &retained[16..] { read(&state, handle).unwrap(); }
    read(&state, &issue(&state)).unwrap();
    fs::remove_dir_all(root).unwrap();
}
