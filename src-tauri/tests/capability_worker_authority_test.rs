#![cfg(unix)]
use app_lib::{capability_runtime::{CapabilityEntrypoint, CapabilityManifest, PlatformState, with_worker_board_authority}, capability_authority::InvocationContext};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{atomic::{AtomicU64, Ordering}, Arc, mpsc}, time::{Duration, Instant}};

fn fixture() -> (PathBuf, PlatformState) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!("nooki-worker-authority-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let state = PlatformState::load(root.clone()).unwrap();
    state.install_capability(CapabilityManifest { id:"example.notes".into(), version:"0.1.0".into(), name:"Notes".into(), description:String::new(), locales:BTreeMap::new(), entrypoints:vec![CapabilityEntrypoint::Page], permissions:vec![], min_platform_version:"0.1.0".into() }).unwrap();
    (root, state)
}
fn issue(state: &PlatformState) -> String { state.grant_board_creation("native-a", "example.notes", "0.1.0").unwrap() }
fn read(root: &Path, handle: &str) -> Result<InvocationContext, String> {
    with_worker_board_authority(root, "native-a", handle, "board.create", "board", |context| Ok(context.clone()))
}
fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.exists() { assert!(Instant::now() < deadline, "child marker missing: {}", path.display()); std::thread::sleep(Duration::from_millis(5)); }
}

#[test]
fn worker_checks_current_authority_without_loading_a_new_host() {
    let (root, state) = fixture(); let handle = issue(&state);
    assert_eq!(read(&root, &handle).unwrap().capability_id, "example.notes");
    for (caller, token, operation, resource) in [("other",handle.as_str(),"board.create","board"), ("native-a","forged","board.create","board"), ("native-a",handle.as_str(),"board.delegate","board"), ("native-a",handle.as_str(),"board.create","other")] {
        assert!(with_worker_board_authority(&root, caller, token, operation, resource, |_| -> Result<(),String> { panic!("denied worker effect ran") }).unwrap_err().contains("PERMISSION_DENIED"));
    }
    state.revoke_board_invocation("native-a", &handle).unwrap();
    assert!(read(&root, &handle).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn shared_record_contains_only_digests_and_restart_cannot_revive_handles() {
    use sha2::{Digest, Sha256};
    use std::os::unix::fs::PermissionsExt;
    let (root, state) = fixture(); let old = issue(&state);
    let path=root.join("capability-invocations.json");
    let record=fs::read_to_string(&path).unwrap();
    assert!(!record.contains(&old));
    let digest=format!("{:x}",Sha256::digest(old.as_bytes()));
    assert!(record.contains(&digest));
    assert!(read(&root, &digest).is_err(), "digest is not a bearer token");
    assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    let restarted=PlatformState::load(root.clone()).unwrap();
    assert!(read(&root,&old).is_err());
    let new=issue(&state); // The first host must not flush a stale cached authority map.
    assert!(read(&root,&old).is_err()); read(&root,&new).unwrap();
    restarted.revoke_board_invocation("native-a",&new).unwrap();
    assert!(state.with_board_authority("native-a",&new,"board.create","board", |_| Ok(())).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn generation_validation_survives_unavailable_record_cleanup_and_reclaims_capacity() {
    let (root, state)=fixture(); let handles:Vec<_>=(0..16).map(|_|issue(&state)).collect();
    let before=read(&root,&handles[0]).unwrap();
    // Denial must follow the committed registry even when the grant-file staging path is unusable.
    fs::create_dir(root.join("capability-invocations.json.tmp")).unwrap();
    state.set_capability_enabled("example.notes",false).unwrap();
    state.set_capability_enabled("example.notes",true).unwrap();
    for handle in &handles { assert!(read(&root,handle).is_err()); }
    fs::remove_dir(root.join("capability-invocations.json.tmp")).unwrap();
    let fresh=issue(&state); assert_ne!(read(&root,&fresh).unwrap().generation,before.generation);
    for _ in 1..16 { issue(&state); }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_revoke_is_not_acknowledged_and_corrupt_records_fail_closed() {
    let (root,state)=fixture(); let handle=issue(&state);
    let path=root.join("capability-invocations.json"); let before=fs::read(&path).unwrap();
    fs::create_dir(path.with_extension("json.tmp")).unwrap();
    assert!(state.revoke_board_invocation("native-a",&handle).is_err());
    assert!(state.grant_board_creation("native-a","example.notes","0.1.0").is_err());
    assert!(PlatformState::load(root.clone()).is_err(), "startup cannot silently skip invalidation");
    assert_eq!(fs::read(&path).unwrap(),before); read(&root,&handle).unwrap();
    fs::remove_dir(path.with_extension("json.tmp")).unwrap();
    fs::write(&path,b"invalid JSON").unwrap();
    assert!(read(&root,&handle).is_err());
    assert!(state.grant_board_creation("native-a","example.notes","0.1.0").is_err());
    fs::write(&path,vec![b' ';512*1024+1]).unwrap();
    assert!(read(&root,&handle).unwrap_err().contains("byte limit"));
    assert!(state.grant_board_creation("native-a","example.notes","0.1.0").is_err());
    // Startup invalidates old records even if an interrupted previous host left corrupt data.
    let restarted=PlatformState::load(root.clone()).unwrap();
    assert!(read(&root,&handle).is_err()); read(&root,&issue(&restarted)).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_host_cannot_overwrite_new_registry_or_issue_stale_authority() {
    let (root,old)=fixture(); let current=PlatformState::load(root.clone()).unwrap();
    current.set_capability_enabled("example.notes",false).unwrap();
    let path=root.join("installed-capabilities/capability-registry.json"); let disk=fs::read(&path).unwrap();
    assert!(old.grant_board_creation("native-a","example.notes","0.1.0").is_err());
    assert!(old.set_capability_enabled("example.notes",true).unwrap_err().contains("CONFLICT"));
    assert_eq!(fs::read(&path).unwrap(),disk);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worker_process_entry() {
    let Some(root)=std::env::var_os("NOOKI_AUTHORITY_CHILD_ROOT") else { return };
    let root=PathBuf::from(root); let handle=fs::read_to_string(root.join("test-handle")).unwrap();
    let result=with_worker_board_authority(&root,"native-a",&handle,"board.create","board", |_| {
        fs::write(root.join("entered"),b"entered").unwrap();
        wait_for(&root.join("release"));
        fs::write(root.join("effect"),b"committed").map_err(|e|e.to_string())
    });
    fs::write(root.join("result"),serde_json::to_vec(&result).unwrap()).unwrap();
}

#[test]
fn actual_process_effect_and_revocation_share_one_commit_boundary() {
    for disable in [false,true] {
        let (root,state)=fixture(); let state=Arc::new(state); let handle=issue(&state);
        fs::write(root.join("test-handle"),&handle).unwrap();
        let mut child=Command::new(std::env::current_exe().unwrap()).args(["--exact","worker_process_entry","--nocapture"])
            .env("NOOKI_AUTHORITY_CHILD_ROOT",&root).stdout(Stdio::null()).spawn().unwrap();
        wait_for(&root.join("entered"));
        let (started_tx,started_rx)=mpsc::channel(); let (done_tx,done_rx)=mpsc::channel();
        let host=state.clone(); let token=handle.clone();
        let revoker=std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            done_tx.send(if disable { host.set_capability_enabled("example.notes",false) } else { host.revoke_board_invocation("native-a",&token) }).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(done_rx.recv_timeout(Duration::from_millis(60)).is_err(),"revocation acknowledged while child effect holds fence");
        fs::write(root.join("release"),b"release").unwrap();
        assert!(child.wait().unwrap().success());
        assert_eq!(fs::read(root.join("effect")).unwrap(),b"committed");
        done_rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap(); revoker.join().unwrap();
        assert!(read(&root,&handle).is_err());
        // A separately dispatched process with the same queued handle must fail before its effect.
        fs::remove_file(root.join("effect")).unwrap(); fs::remove_file(root.join("entered")).unwrap();
        let status=Command::new(std::env::current_exe().unwrap()).args(["--exact","worker_process_entry"])
            .env("NOOKI_AUTHORITY_CHILD_ROOT",&root).stdout(Stdio::null()).status().unwrap();
        assert!(status.success()); assert!(!root.join("entered").exists()); assert!(!root.join("effect").exists());
        let result:Result<(),String>=serde_json::from_slice(&fs::read(root.join("result")).unwrap()).unwrap();
        assert!(result.unwrap_err().contains("PERMISSION_DENIED"));
        fs::remove_dir_all(root).unwrap();
    }
}
