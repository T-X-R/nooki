//! A read-only view of task state. This module never starts or resumes agent work.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

const PET: &str = "desktop-pet";
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
struct Anchor { x: i32, y: i32 }
#[derive(Clone, Copy, Default, Serialize)]
pub struct PetView { right: f64, bottom: f64, below: bool }
struct Placement { anchor: Anchor, position: PhysicalPosition<i32>, size: PhysicalSize<u32>, offset: Anchor, view: PetView }
#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences { enabled: bool, anchor: Option<Anchor>, language: String, theme: String }
impl Default for Preferences {
    fn default() -> Self { Self { enabled: false, anchor: None, language: "zh".into(), theme: "light".into() } }
}
#[derive(Default)]
struct PetLayout { anchor: Option<Anchor>, expanded: bool, offset: Anchor }
impl PetLayout {
    fn transition(&mut self, expanded: bool) -> bool {
        if self.expanded == expanded { return false; }
        self.expanded = expanded;
        true
    }
}
pub struct DesktopPet { root: PathBuf, preferences: Mutex<Preferences>, layout: Mutex<PetLayout>, target: Mutex<Option<String>> }
impl DesktopPet {
    pub fn load(root: PathBuf) -> Result<Self, String> {
        let path = root.join("desktop-pet.json");
        let preferences = if path.exists() { serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())? } else { Preferences::default() };
        Ok(Self { root, preferences: Mutex::new(preferences), layout: Mutex::new(PetLayout::default()), target: Mutex::new(None) })
    }
    fn preferences(&self) -> Preferences { self.preferences.lock().unwrap().clone() }
    fn update(&self, change: impl FnOnce(&mut Preferences)) -> Result<Preferences, String> {
        let mut guard = self.preferences.lock().unwrap();
        let mut next = guard.clone();
        change(&mut next);
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let temporary = self.root.join("desktop-pet.pending");
        fs::write(&temporary, serde_json::to_vec(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(temporary, self.root.join("desktop-pet.json")).map_err(|e| e.to_string())?;
        *guard = next.clone();
        Ok(next)
    }
}
fn caller(window: &WebviewWindow, label: &str) -> Result<(), String> {
    if window.label() == label { Ok(()) } else { Err("This operation is unavailable in this window".into()) }
}
fn dimensions(scale: f64, expanded: bool) -> PhysicalSize<u32> {
    PhysicalSize::new(((if expanded { 320.0 } else { 160.0 }) * scale).round() as u32, ((if expanded { 386.0 } else { 108.0 }) * scale).round() as u32)
}
fn clamp_anchor(anchor: Anchor, origin: Anchor, size: PhysicalSize<u32>, window: PhysicalSize<u32>, margin: i32) -> Anchor {
    let right = origin.x + size.width as i32 - margin;
    let bottom = origin.y + size.height as i32 - margin;
    Anchor { x: anchor.x.clamp((origin.x + window.width as i32 + margin).min(right), right), y: anchor.y.clamp((origin.y + window.height as i32 + margin).min(bottom), bottom) }
}
fn placement(anchor: Anchor, origin: Anchor, area: PhysicalSize<u32>, scale: f64, expanded: bool) -> Placement {
    // Padding belongs to the panel content, not the cat's saved desktop position.
    let margin = 0;
    let cat = dimensions(scale, false);
    let anchor = clamp_anchor(anchor, origin, area, cat, margin);
    let mut size = dimensions(scale, expanded);
    size.width = size.width.min(area.width.saturating_sub(2 * margin as u32).max(1));
    size.height = size.height.min(area.height.saturating_sub(2 * margin as u32).max(1));
    let above = anchor.y - cat.height as i32 - origin.y - margin;
    let below_space = origin.y + area.height as i32 - margin - anchor.y;
    let below = expanded && above < (size.height - cat.height.min(size.height)) as i32 && below_space > above;
    let frame = clamp_anchor(Anchor { x: anchor.x, y: if below { anchor.y - cat.height as i32 + size.height as i32 } else { anchor.y } }, origin, area, size, margin);
    let offset = Anchor { x: frame.x - anchor.x, y: frame.y - anchor.y };
    Placement { anchor, position: PhysicalPosition::new(frame.x - size.width as i32, frame.y - size.height as i32), size, offset,
        view: PetView { right: offset.x as f64 / scale, bottom: offset.y as f64 / scale, below } }
}
fn window_anchor(window: &WebviewWindow, offset: Anchor) -> Result<Anchor, String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(Anchor { x: position.x + size.width as i32 - offset.x, y: position.y + size.height as i32 - offset.y })
}
fn place(window: &WebviewWindow, expanded: bool, anchor: Option<Anchor>) -> Result<Placement, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = anchor.and_then(|a| monitors.iter().find(|m| {
        let area = m.work_area();
        a.x > area.position.x && a.x <= area.position.x + area.size.width as i32 && a.y > area.position.y && a.y <= area.position.y + area.size.height as i32
    }).cloned()).or(window.primary_monitor().map_err(|e| e.to_string())?).ok_or("No display available")?;
    let area = monitor.work_area();
    let origin = Anchor { x: area.position.x, y: area.position.y };
    let margin = (16.0 * monitor.scale_factor()) as i32;
    let placement = placement(anchor.unwrap_or(Anchor { x: origin.x + area.size.width as i32 - margin, y: origin.y + area.size.height as i32 - margin }), origin, area.size, monitor.scale_factor(), expanded);
    window.set_size(placement.size).map_err(|e| e.to_string())?;
    window.set_position(placement.position).map_err(|e| e.to_string())?;
    Ok(placement)
}
fn create(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PET) { return window.show().map_err(|e| e.to_string()); }
    let window = WebviewWindowBuilder::new(app, PET, WebviewUrl::App("index.html?desktop-pet".into()))
        .title("Nooki Pet").inner_size(160.0, 108.0).decorations(false).transparent(true)
        .resizable(false).maximizable(false).minimizable(false).shadow(false)
        .always_on_top(true).skip_taskbar(true).visible_on_all_workspaces(true)
        .focused(false).visible(false).accept_first_mouse(true).disable_drag_drop_handler()
        .build().map_err(|e| e.to_string())?;
    match place(&window, false, app.state::<DesktopPet>().preferences().anchor) {
        Ok(p) => *app.state::<DesktopPet>().layout.lock().unwrap() = PetLayout { anchor: Some(p.anchor), expanded: false, offset: p.offset },
        Err(error) => { let _ = window.destroy(); return Err(error); }
    }
    // The renderer reveals the window only after its transparent layout is ready.
    Ok(())
}
pub fn initialize(app: &AppHandle, root: PathBuf) -> Result<(), String> {
    app.manage(DesktopPet::load(root)?);
    if app.state::<DesktopPet>().preferences().enabled {
        if let Err(error) = create(app) {
            log::warn!(target: "workbench::desktop_pet", "Could not restore pet: {error}");
            app.state::<DesktopPet>().update(|p| p.enabled = false)?;
        }
    }
    Ok(())
}
pub fn keep_main(app: &AppHandle) -> bool { app.state::<DesktopPet>().preferences().enabled }
pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window("main") { window } else {
        let config = app.config().app.windows.iter().find(|c| c.label == "main").ok_or("Main window configuration missing")?;
        WebviewWindowBuilder::from_config(app, config).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?
    };
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
pub fn collapse(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PET) {
        if matches!(resize(&window, false), Ok(Some(_))) {
            let _ = window.emit("desktop-pet:collapsed", ());
        }
    }
}
fn resize(window: &WebviewWindow, expanded: bool) -> Result<Option<PetView>, String> {
    let state = window.state::<DesktopPet>();
    let anchor = {
        let mut layout = state.layout.lock().unwrap();
        // Focus loss and conversation navigation can both collapse the window.
        // Never derive the next anchor from geometry halfway through a resize.
        if !layout.transition(expanded) { return Ok(None); }
        layout.anchor
    };
    match place(window, expanded, anchor) {
        Ok(p) => {
            let mut layout = state.layout.lock().unwrap();
            layout.anchor = Some(p.anchor);
            layout.offset = p.offset;
            Ok(Some(p.view))
        }
        Err(error) => { state.layout.lock().unwrap().expanded = !expanded; Err(error) }
    }
}

#[tauri::command]
pub fn desktop_pet_preferences(state: tauri::State<'_, DesktopPet>) -> Preferences { state.preferences() }
#[tauri::command]
pub async fn desktop_pet_set_enabled(window: WebviewWindow, app: AppHandle, enabled: bool) -> Result<Preferences, String> {
    caller(&window, "main")?;
    let state = app.state::<DesktopPet>();
    if enabled { create(&app)?; }
    let preferences = match state.update(|p| p.enabled = enabled) {
        Ok(preferences) => preferences,
        Err(error) => {
            if enabled && !state.preferences().enabled { if let Some(pet) = app.get_webview_window(PET) { let _ = pet.destroy(); } }
            return Err(error);
        }
    };
    if !enabled { if let Some(pet) = app.get_webview_window(PET) { pet.destroy().map_err(|e| e.to_string())?; } }
    Ok(preferences)
}
#[tauri::command]
pub fn desktop_pet_appearance(window: WebviewWindow, state: tauri::State<'_, DesktopPet>, language: String, theme: String) -> Result<(), String> {
    caller(&window, "main")?;
    if !["zh", "en"].contains(&language.as_str()) || !["light", "dark"].contains(&theme.as_str()) { return Err("Invalid appearance".into()); }
    let current = state.preferences();
    if current.language != language || current.theme != theme { state.update(|p| { p.language = language; p.theme = theme; })?; }
    Ok(())
}
#[tauri::command]
pub fn desktop_pet_ready(window: WebviewWindow) -> Result<(), String> { caller(&window, PET)?; window.show().map_err(|e| e.to_string()) }
#[tauri::command]
pub fn desktop_pet_snapshot(window: WebviewWindow, state: tauri::State<'_, DesktopPet>) -> Result<Value, String> {
    caller(&window, PET)?;
    snapshot(&state)
}
fn snapshot(state: &DesktopPet) -> Result<Value, String> {
    let board = crate::task_goals::load(&state.root)?;
    let cards: Vec<Value> = board["cards"].as_array().unwrap().iter().map(|card| json!({
        "id":card["id"], "title":card["title"], "status":card["status"], "threadId":card["threadId"],
        "archived":card["archived"] == true, "activeTurn":card["activeTurn"] == true,
        "needsInput":card["requests"].as_array().is_some_and(|r| !r.is_empty()), "goalActive":card["goal"]["status"] == "active"
    })).collect();
    Ok(json!({"preferences":state.preferences(), "board":{"cards":cards, "paused":board["paused"] == true}}))
}
#[tauri::command]
pub fn desktop_pet_expand(window: WebviewWindow, expanded: bool) -> Result<Option<PetView>, String> {
    caller(&window, PET)?;
    resize(&window, expanded)
}
#[tauri::command]
pub fn desktop_pet_save_position(window: WebviewWindow, state: tauri::State<'_, DesktopPet>) -> Result<(), String> {
    caller(&window, PET)?;
    let offset = state.layout.lock().unwrap().offset;
    let anchor = window_anchor(&window, offset)?;
    if state.preferences().anchor != Some(anchor) { state.update(|p| p.anchor = Some(anchor))?; }
    state.layout.lock().unwrap().anchor = Some(anchor);
    Ok(())
}
#[tauri::command]
pub async fn desktop_pet_open_conversation(window: WebviewWindow, app: AppHandle, id: String) -> Result<(), String> {
    caller(&window, PET)?;
    let state = app.state::<DesktopPet>();
    let board = crate::task_goals::load(&state.root)?;
    let card = board["cards"].as_array().unwrap().iter().find(|c| c["id"] == id && c["archived"] != true).ok_or("Task is no longer available")?;
    let thread = card["threadId"].as_str().filter(|s| !s.is_empty()).ok_or("This task has no conversation yet")?;
    *state.target.lock().unwrap() = Some(thread.into());
    show_main(&app)?;
    app.emit_to("main", "desktop-pet:navigate", ()).map_err(|e| e.to_string())?;
    collapse(&app);
    Ok(())
}
#[tauri::command]
pub fn desktop_pet_navigation(window: WebviewWindow, state: tauri::State<'_, DesktopPet>) -> Result<Option<String>, String> {
    caller(&window, "main")?;
    Ok(state.target.lock().unwrap().clone())
}
#[tauri::command]
pub fn desktop_pet_navigation_ack(window: WebviewWindow, state: tauri::State<'_, DesktopPet>, id: String) -> Result<(), String> {
    caller(&window, "main")?;
    let mut target = state.target.lock().unwrap();
    if target.as_ref() == Some(&id) { *target = None; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_screen_corners_keep_the_cat_fixed_and_the_panel_inside_the_work_area() {
        for scale in [1.0, 2.0] {
            let origin = Anchor { x: -1920, y: 30 };
            let area = PhysicalSize::new((1440.0 * scale) as u32, (900.0 * scale) as u32);
            let margin = 0;
            let cat = dimensions(scale, false);
            for left in [true, false] { for top in [true, false] {
                let anchor = Anchor {
                    x: if left { origin.x + margin + cat.width as i32 } else { origin.x + area.width as i32 - margin },
                    y: if top { origin.y + margin + cat.height as i32 } else { origin.y + area.height as i32 - margin },
                };
                let p = placement(anchor, origin, area, scale, true);
                assert_eq!(p.anchor, anchor);
                assert_eq!(p.view.below, top);
                assert_eq!(p.view.right, if left { 160.0 } else { 0.0 });
                assert!(p.position.x >= origin.x + margin && p.position.y >= origin.y + margin);
                assert!(p.position.x + p.size.width as i32 <= origin.x + area.width as i32 - margin);
                assert!(p.position.y + p.size.height as i32 <= origin.y + area.height as i32 - margin);
                assert_eq!(Anchor { x: p.position.x + p.size.width as i32 - p.offset.x, y: p.position.y + p.size.height as i32 - p.offset.y }, anchor);
                let collapsed = placement(p.anchor, origin, area, scale, false);
                assert_eq!(collapsed.anchor, anchor);
                assert_eq!(collapsed.offset, Anchor::default());
            } }
        }
    }
    #[test]
    fn clamp_handles_removed_displays_negative_origins_and_small_work_areas() {
        let origin = Anchor { x: -1920, y: 25 };
        let size = PhysicalSize::new(1920, 1055);
        let pet = dimensions(1.0, false);
        assert_eq!(clamp_anchor(Anchor { x: 4000, y: 4000 }, origin, size, pet, 16), Anchor { x: -16, y: 1064 });
        assert_eq!(clamp_anchor(Anchor { x: -3000, y: -900 }, origin, size, pet, 16), Anchor { x: -1744, y: 149 });
        let small = clamp_anchor(Anchor { x: 0, y: 0 }, Anchor { x: 0, y: 0 }, PhysicalSize::new(100, 100), pet, 16);
        assert_eq!(small, Anchor { x: 84, y: 84 });
    }
    #[test]
    fn opening_a_conversation_and_focus_loss_collapse_once_without_moving_the_anchor() {
        let anchor = Some(Anchor { x: 1200, y: 780 });
        let mut layout = PetLayout { anchor, ..PetLayout::default() };
        assert!(layout.transition(true));
        assert!(layout.transition(false));
        assert!(!layout.transition(false));
        assert_eq!(layout.anchor, anchor);
        assert!(layout.transition(true));
        assert_eq!(layout.anchor, anchor);
    }
    #[test]
    fn preferences_survive_restart_without_touching_tasks() {
        let root = std::env::temp_dir().join(format!("nooki-pet-prefs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let pet = DesktopPet::load(root.clone()).unwrap();
        assert!(!pet.preferences().enabled);
        pet.update(|p| { p.enabled = true; p.anchor = Some(Anchor { x: 800, y: 600 }); p.language = "en".into(); }).unwrap();
        let restored = DesktopPet::load(root.clone()).unwrap();
        assert!(restored.preferences().enabled);
        assert_eq!(restored.preferences().anchor, Some(Anchor { x: 800, y: 600 }));
        assert_eq!(restored.preferences().language, "en");
        assert!(!root.join("task-worker.sock").exists());
        assert!(!root.join("task-board.json").exists());
        assert_eq!(snapshot(&restored).unwrap()["board"]["cards"], json!([]));
        assert!(!root.join("task-board.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
