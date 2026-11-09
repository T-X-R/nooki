use serde::Serialize;
use tauri::{App, WebviewWindow};

#[cfg(target_os = "macos")]
use {crate::capability_runtime::PlatformState, std::time::Duration, tauri::Manager, tauri_plugin_updater::{Update, UpdaterExt}};

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateCheck {
    Unavailable,
    UpToDate,
    Available { version: String, notes: Option<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallResult {
    Busy,
    CheckAgain,
}

pub fn setup(_app: &App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if _app.config().plugins.0.contains_key("updater") {
        _app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn check(app: &tauri::AppHandle) -> Result<Option<Update>, String> {
    let updater = app.updater_builder().timeout(Duration::from_secs(300)).build().map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(15), updater.check()).await
        .map_err(|_| "Update check timed out".to_owned())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn app_update_check(window: WebviewWindow) -> Result<UpdateCheck, String> {
    #[cfg(target_os = "macos")]
    if window.label() == "main" && window.app_handle().config().plugins.0.contains_key("updater") {
        return Ok(match check(window.app_handle()).await? {
            Some(update) => UpdateCheck::Available { version: update.version, notes: update.body },
            None => UpdateCheck::UpToDate,
        });
    }
    Ok(UpdateCheck::Unavailable)
}

#[tauri::command]
pub async fn app_update_install(window: WebviewWindow, version: String) -> Result<InstallResult, String> {
    #[cfg(target_os = "macos")]
    if window.label() == "main" && window.app_handle().config().plugins.0.contains_key("updater") {
        let app = window.app_handle();
        let platform = app.state::<PlatformState>();
        let root = platform.data_dir();
        let Some(_install) = crate::task_worker::file_lock(&root.join("app-update.lock"))? else {
            return Ok(InstallResult::Busy);
        };
        let Some(update) = check(app).await?.filter(|update| update.version == version) else {
            return Ok(InstallResult::CheckAgain);
        };
        if platform.read_tasks()?.iter().any(|record| record["status"] == "running") {
            return Ok(InstallResult::Busy);
        }
        let package = update.download(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
        let Some(_worker) = crate::task_worker::update_guard(root).await? else {
            return Ok(InstallResult::Busy);
        };
        if platform.read_tasks()?.iter().any(|record| record["status"] == "running") {
            return Ok(InstallResult::Busy);
        }
        update.install(package).map_err(|error| error.to_string())?;
        app.restart();
    }
    Err("App updates are unavailable in this build".into())
}
