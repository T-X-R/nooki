use std::{collections::HashMap, ffi::OsString, fs};
use app_lib::app_profile::configure;

#[test]
fn baseline_profile_refuses_agent_execution_before_spawning() {
    if std::env::var_os("NOOKI_PROFILE_CHILD_TEST").is_some() {
        assert!(app_lib::agent_tools::with_launcher_path("codex").unwrap_err().to_string().contains("disabled in baseline test profiles"));
        assert!(app_lib::agent_tools::with_launcher_path("claude").is_err());
        assert!(app_lib::agent_tools::with_launcher_path("pi").is_err());
        return;
    }
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "baseline_profile_refuses_agent_execution_before_spawning"])
        .env("NOOKI_PROFILE_CHILD_TEST", "1").env("NOOKI_TEST_PROFILE", "/unused-profile")
        .status().unwrap();
    assert!(status.success());
}

#[test]
fn normal_startup_keeps_the_config_and_missing_profile_fails_closed() {
    let mut config = tauri::utils::config::Config::default();
    let original = serde_json::to_value(&config).unwrap();
    configure(&mut config, |_| None).unwrap();
    assert_eq!(serde_json::to_value(&config).unwrap(), original);
    assert!(configure(&mut config, |key| (key == "NOOKI_TEST_PROFILE").then(|| OsString::from("relative"))).is_err());
    assert_eq!(serde_json::to_value(&config).unwrap(), original);
}

#[test]
fn profile_routes_native_storage_and_persistent_webviews_and_requires_separate_agent_homes() {
    let root = std::env::temp_dir().join(format!("nooki-profile-{}", std::process::id()));
    fs::create_dir_all(root.join("home")).unwrap();
    let root = root.canonicalize().unwrap();
    fs::write(root.join("profile.json"), r#"{"format":"nooki-test-profile","version":1,"storeId":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]}"#).unwrap();
    let mut env = HashMap::from([
        ("NOOKI_TEST_PROFILE", root.as_os_str().to_owned()),
        ("HOME", root.join("home").into_os_string()),
        ("CODEX_HOME", root.join("home/.codex").into_os_string()),
        ("CLAUDE_CONFIG_DIR", root.join("home/.claude").into_os_string()),
    ]);
    let mut config = tauri::utils::config::Config::default();
    config.app.windows.push(Default::default());
    config.plugins.0.insert("updater".into(), serde_json::json!({}));
    configure(&mut config, |key| env.get(key).cloned()).unwrap();
    assert_eq!(serde_json::to_value(&config).unwrap()["app"]["appDirectoriesOverride"], root.join("data").to_str().unwrap());
    assert_eq!(config.app.windows[0].data_store_identifier, Some([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]));
    assert!(!config.app.windows[0].create, "profile windows must use the explicit data-store builder instead of Tauri's automatic config conversion");
    assert!(!config.plugins.0.contains_key("updater"));
    assert_ne!(config.identifier, "com.personal.workbench");
    env.insert("CODEX_HOME", OsString::from("/ordinary/.codex"));
    assert!(configure(&mut config, |key| env.get(key).cloned()).is_err());
    fs::remove_dir_all(root).unwrap();
}
