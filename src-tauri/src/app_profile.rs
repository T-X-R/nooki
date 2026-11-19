//! Opt-in development profiles. This is storage isolation, not a package sandbox.
use std::{ffi::OsString, fs, path::PathBuf};
use serde::Deserialize;
use tauri::utils::config::{AppDirectoriesOverride, Config};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile { format: String, version: u32, store_id: [u8; 16] }

pub fn configure(config: &mut Config, env: impl Fn(&str) -> Option<OsString>) -> Result<(), String> {
    let Some(root) = env("NOOKI_TEST_PROFILE") else { return Ok(()); };
    let root = PathBuf::from(root);
    if !root.is_absolute() { return Err("Test profile path must be absolute".into()); }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let profile: Profile = serde_json::from_slice(&fs::read(root.join("profile.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if profile.format != "nooki-test-profile" || profile.version != 1 {
        return Err("Invalid test profile".into());
    }
    for (key, relative) in [("HOME", "home"), ("CODEX_HOME", "home/.codex"), ("CLAUDE_CONFIG_DIR", "home/.claude")] {
        if env(key).map(PathBuf::from) != Some(root.join(relative)) {
            return Err(format!("Test profile requires an isolated {key}; use scripts/desktop-profile.mjs"));
        }
    }
    let suffix: String = profile.store_id.iter().map(|byte| format!("{byte:02x}")).collect();
    config.identifier = format!("com.personal.workbench.profile.{suffix}");
    config.app.app_directories_override = Some(AppDirectoriesOverride::Root(root.join("data")));
    config.plugins.0.remove("updater");
    for window in &mut config.app.windows {
        window.title = "Nooki — Test Profile".into();
        window.data_store_identifier = Some(profile.store_id);
    }
    Ok(())
}
