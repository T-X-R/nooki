//! Disposable macOS WKWebView experiment. No Nooki services or user data are loaded.
#[path = "capability_runtime_probe/policy.rs"]
mod policy;
// Import only profile routing, avoiding the production application's embedded context and services.
#[allow(dead_code)]
#[path = "../src/app_profile.rs"]
mod app_profile;

use std::{collections::BTreeMap, fs, io::{Read, Write}, net::{TcpListener, TcpStream, UdpSocket}, path::PathBuf, sync::Mutex, time::{Duration, Instant}};
use serde_json::{json, Value};
use tauri::{Manager, State, WebviewWindow};

struct Probe {
    root: PathBuf,
    started: Instant,
    events: Mutex<Vec<Value>>,
    ticks: Mutex<BTreeMap<String, u64>>,
}

impl Probe {
    fn record(&self, caller: &str, value: Value) {
        let mut events = self.events.lock().unwrap();
        if events.len() >= 256 { return; }
        events.push(json!({"caller": caller, "elapsedMs": self.started.elapsed().as_millis(), "value": value}));
        fs::write(self.root.join("events.json"), serde_json::to_vec_pretty(&*events).unwrap()).unwrap();
    }
}

#[tauri::command]
fn probe_rpc(window: WebviewWindow, owner: String, payload: String) -> Result<String, String> {
    policy::authorize(window.label(), &owner, payload.len()).map_err(str::to_owned)?;
    Ok(payload)
}

// Intentionally unguarded synthetic sentinel: measures Tauri's default app-command exposure.
#[tauri::command]
fn probe_unguarded() -> &'static str { "synthetic-unguarded-sentinel" }

#[tauri::command]
fn probe_host_secret(window: WebviewWindow) -> Result<&'static str, &'static str> {
    if window.label() != "probe-shell" { return Err("host-only operation"); }
    Ok("synthetic-host-sentinel")
}

#[tauri::command]
fn probe_report(window: WebviewWindow, value: Value, state: State<Probe>) -> Result<(), String> {
    policy::authorize(window.label(), window.label(), value.to_string().len()).map_err(str::to_owned)?;
    state.record(window.label(), value);
    Ok(())
}

#[tauri::command]
fn probe_tick(window: WebviewWindow, state: State<Probe>) {
    *state.ticks.lock().unwrap().entry(window.label().into()).or_default() += 1;
}

#[tauri::command]
async fn probe_control(window: WebviewWindow, action: String, state: State<'_, Probe>) -> Result<Value, String> {
    if window.label() != "probe-shell" { return Err("host-only operation".into()); }
    let started = Instant::now();
    let app = window.app_handle();
    match action.as_str() {
        "run" => for target in app.webview_windows().values() {
            record_process_id(target);
            target.eval("void window.runProbe()").map_err(|e| e.to_string())?;
        },
        "busy" => app.get_webview_window("probe-a").ok_or("A already destroyed")?
            .eval("void window.startBusy()").map_err(|e| e.to_string())?,
        "stop" => if let Some(target) = app.get_webview_window("probe-a") {
            target.destroy().map_err(|e| e.to_string())?;
        },
        "status" => (),
        _ => return Err("unknown probe action".into()),
    }
    let result = json!({"action": action, "elapsedMs": started.elapsed().as_millis(), "windows": app.webview_windows().keys().collect::<Vec<_>>(), "ticks": *state.ticks.lock().unwrap()});
    state.record("native", result.clone());
    Ok(result)
}

#[cfg(target_os = "macos")]
fn record_process_id(window: &WebviewWindow) {
    // Diagnostic only: WebKit's own MiniBrowser uses this private selector. Never use it
    // for production identity or termination; the probe only observes the returned PID.
    use std::ffi::{c_char, c_void};
    #[link(name = "objc")]
    extern "C" { fn sel_registerName(name: *const c_char) -> *mut c_void; fn objc_msgSend(); }
    let app = window.app_handle().clone(); let label = window.label().to_owned();
    window.with_webview(move |view| unsafe {
        let selector = sel_registerName(c"_webProcessIdentifier".as_ptr());
        let responds: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> bool = std::mem::transmute(objc_msgSend as *const ());
        if responds(view.inner(), sel_registerName(c"respondsToSelector:".as_ptr()), selector) {
            let read: extern "C" fn(*mut c_void, *mut c_void) -> i32 = std::mem::transmute(objc_msgSend as *const ());
            app.state::<Probe>().record(&label, json!({"diagnosticWebProcessId": read(view.inner(), selector)}));
        }
    }).unwrap();
}

#[cfg(not(target_os = "macos"))]
fn record_process_id(_: &WebviewWindow) {}

fn receivers(app: &tauri::AppHandle, label: &str) -> (u16, u16) {
    let tcp = TcpListener::bind("127.0.0.1:0").unwrap();
    let udp = UdpSocket::bind("127.0.0.1:0").unwrap();
    let http_port = tcp.local_addr().unwrap().port();
    let udp_port = udp.local_addr().unwrap().port();
    let handle = app.clone(); let owner = label.to_owned();
    std::thread::spawn(move || {
        for stream in tcp.incoming() {
            let Ok(mut stream) = stream else { break; };
            stream.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
            let mut bytes = [0; 2048];
            let count = stream.read(&mut bytes).unwrap_or(0);
            handle.state::<Probe>().record(&owner, json!({"received": "tcp", "bytes": count, "positiveControl": bytes[..count].starts_with(b"GET /receiver-control ")}));
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
    });
    let handle = app.clone(); let owner = label.to_owned();
    std::thread::spawn(move || {
        let mut bytes = [0; 2048];
        while let Ok((count, _)) = udp.recv_from(&mut bytes) {
            handle.state::<Probe>().record(&owner, json!({"received": "udp", "bytes": count, "positiveControl": &bytes[..count] == b"receiver-control"}));
        }
    });
    // Positive controls ensure that an empty receiver log is not mistaken for network denial.
    TcpStream::connect(("127.0.0.1", http_port)).unwrap().write_all(b"GET /receiver-control HTTP/1.0\r\n\r\n").unwrap();
    UdpSocket::bind("127.0.0.1:0").unwrap().send_to(b"receiver-control", ("127.0.0.1", udp_port)).unwrap();
    (http_port, udp_port)
}

fn silent_wav() -> Vec<u8> {
    let mut data = b"RIFF".to_vec();
    data.extend(2036u32.to_le_bytes()); data.extend(b"WAVEfmt "); data.extend(16u32.to_le_bytes());
    data.extend(1u16.to_le_bytes()); data.extend(1u16.to_le_bytes()); data.extend(8000u32.to_le_bytes());
    data.extend(16000u32.to_le_bytes()); data.extend(2u16.to_le_bytes()); data.extend(16u16.to_le_bytes());
    data.extend(b"data"); data.extend(2000u32.to_le_bytes()); data.resize(2044, 0); data
}

fn main() {
    assert!(cfg!(target_os = "macos"), "This experiment currently measures macOS only");
    let root = PathBuf::from(std::env::var_os("NOOKI_TEST_PROFILE").expect("Use the isolated profile launcher"));
    let mut context = tauri::generate_context!("examples/capability_runtime_probe/tauri.conf.json");
    app_profile::configure(context.config_mut(), |key| std::env::var_os(key)).expect("isolated profile configuration");
    tauri::Builder::default()
        .manage(Probe { root, started: Instant::now(), events: Mutex::new(Vec::new()), ticks: Mutex::new(BTreeMap::new()) })
        .invoke_handler(tauri::generate_handler![probe_rpc, probe_unguarded, probe_host_secret, probe_report, probe_tick, probe_control])
        .register_uri_scheme_protocol("nookiprobe", |ctx, request| {
            let (status, mime, data) = match request.uri().path() {
                "/index.html" => (200, "text/html", include_bytes!("capability_runtime_probe/assets/index.html").to_vec()),
                "/probe.js" => (200, "text/javascript", include_bytes!("capability_runtime_probe/assets/probe.js").to_vec()),
                "/pixel.svg" => (200, "image/svg+xml", br##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#479"/></svg>"##.to_vec()),
                "/tone.wav" => (200, "audio/wav", silent_wav()),
                _ => (403, "text/plain", b"No package-private route".to_vec()),
            };
            let mut response = tauri::http::Response::builder().status(status).header("Content-Type", mime);
            if ctx.webview_label() != "probe-control" {
                response = response.header("Content-Security-Policy", "default-src 'none'; script-src nookiprobe:; style-src 'unsafe-inline'; connect-src nookiprobe: ipc: http://ipc.localhost; img-src nookiprobe:; media-src nookiprobe:; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
            }
            response.body(data).unwrap()
        })
        .setup(|app| {
            for (index, label) in ["probe-shell", "probe-a", "probe-b", "probe-control"].iter().enumerate() {
                let (http_port, udp_port) = receivers(app.handle(), label);
                let navigation_app = app.handle().clone(); let owner = label.to_string();
                let popup_app = app.handle().clone(); let popup_owner = label.to_string();
                tauri::WebviewWindowBuilder::new(app, *label, tauri::WebviewUrl::External("nookiprobe://localhost/index.html".parse()?))
                    .title(format!("Nooki Runtime Probe — {label}"))
                    .inner_size(640.0, 700.0).position(80.0 + index as f64 * 80.0, 80.0 + index as f64 * 35.0)
                    .incognito(true)
                    .initialization_script(format!("window.PROBE = {};", json!({"label": label, "httpPort": http_port, "udpPort": udp_port})))
                    .on_navigation(move |url| {
                        let allowed = url.as_str() == "nookiprobe://localhost/index.html";
                        if !allowed { navigation_app.state::<Probe>().record(&owner, json!({"navigationDenied": true})); }
                        allowed
                    })
                    .on_new_window(move |_, _| {
                        popup_app.state::<Probe>().record(&popup_owner, json!({"popupDenied": true}));
                        tauri::webview::NewWindowResponse::Deny
                    }).build()?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(300));
                handle.state::<Probe>().record("native", json!({"watchdogExit": true}));
                handle.exit(1);
            });
            Ok(())
        })
        .run(context).expect("runtime probe");
}
