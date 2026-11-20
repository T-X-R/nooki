//! Disposable macOS WKWebView experiment. No Nooki services or user data are loaded.
#[path = "capability_runtime_probe/policy.rs"]
mod policy;
#[path = "capability_runtime_probe/admission.rs"]
mod admission;
#[cfg(any(test, feature = "runtime-probe-receive"))]
#[path = "capability_runtime_probe/receive_policy.rs"]
mod receive_policy;
#[cfg(feature = "runtime-probe-receive")]
#[path = "capability_runtime_probe/receive_boundary.rs"]
mod receive_boundary;
#[cfg(target_os = "macos")]
#[path = "capability_runtime_probe/native_configuration.rs"]
mod native_configuration;
// Import only profile routing, avoiding the production application's embedded context and services.
#[allow(dead_code)]
#[path = "../src/app_profile.rs"]
mod app_profile;

use std::{collections::BTreeMap, fs, io::{Read, Write}, net::{TcpListener, TcpStream, UdpSocket}, path::PathBuf, sync::Mutex, time::{Duration, Instant}};
use serde_json::{json, Value};
use tauri::{Manager, State, Webview};

fn probe_views(app: &tauri::AppHandle) -> std::collections::HashMap<String, Webview> {
    #[cfg(feature = "runtime-probe-embedded")]
    { app.webviews() }
    #[cfg(not(feature = "runtime-probe-embedded"))]
    { app.webview_windows().into_iter().map(|(label, window)| (label, window.as_ref().clone())).collect() }
}

struct Probe {
    root: PathBuf,
    started: Instant,
    events: Mutex<Vec<Value>>,
    ticks: Mutex<BTreeMap<String, u64>>,
    admission: admission::Admission,
    #[cfg(feature = "runtime-probe-receive")]
    receiving: admission::Admission,
    #[cfg(feature = "runtime-probe-receive")]
    receive_rate: receive_policy::Rate,
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
fn probe_rpc(window: Webview, owner: String, payload: String) -> Result<String, String> {
    policy::authorize(window.label(), &owner, payload.len()).map_err(str::to_owned)?;
    Ok(payload)
}

#[tauri::command]
fn probe_identity(window: Webview) -> Value {
    json!({"view": window.label(), "window": window.window().label()})
}

#[tauri::command]
async fn probe_load(window: Webview, payload: String, state: State<'_, Probe>) -> Result<Value, String> {
    // Tauri has already decoded this request. This bounds admitted operation payloads,
    // not browser allocations, transport buffers or the framework's pre-dispatch queue.
    let _permit = state.admission.acquire(window.label(), payload.len()).map_err(str::to_owned)?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    if payload == "synthetic-failure" { return Err("synthetic operation failed".into()); }
    Ok(json!({"bytes": payload.len(), "checksum": payload.bytes().map(u64::from).sum::<u64>()}))
}

// Intentionally unguarded synthetic sentinel: measures Tauri's default app-command exposure.
#[tauri::command]
fn probe_unguarded() -> &'static str { "synthetic-unguarded-sentinel" }

#[tauri::command]
fn probe_host_secret(window: Webview) -> Result<&'static str, &'static str> {
    if window.label() != "probe-shell" { return Err("host-only operation"); }
    Ok("synthetic-host-sentinel")
}

#[tauri::command]
fn probe_report(window: Webview, value: Value, state: State<Probe>) -> Result<(), String> {
    policy::authorize(window.label(), window.label(), value.to_string().len()).map_err(str::to_owned)?;
    state.record(window.label(), value);
    Ok(())
}

#[tauri::command]
fn probe_tick(window: Webview, state: State<Probe>) {
    *state.ticks.lock().unwrap().entry(window.label().into()).or_default() += 1;
}

#[tauri::command]
async fn probe_control(window: Webview, action: String, channel: Option<tauri::ipc::JavaScriptChannelId>, state: State<'_, Probe>) -> Result<Value, String> {
    if window.label() != "probe-shell" { return Err("host-only operation".into()); }
    let started = Instant::now();
    let app = window.app_handle();
    match action.as_str() {
        "run" => for target in probe_views(app).values() {
            record_process_id(target);
            target.eval("void window.runProbe()").map_err(|e| e.to_string())?;
        },
        "extended" => for target in probe_views(app).values() {
            target.eval("void window.runExtendedProbe()").map_err(|e| e.to_string())?;
        },
        "load" | "ingress" | "receive" => for label in ["probe-a", "probe-b"] {
            if let Some(target) = probe_views(app).get(label) {
                let script = match action.as_str() { "load" => "void window.runLoadProbe()", "receive" => "void window.runReceiveProbe()", _ => "void window.runIngressProbe()" };
                target.eval(script).map_err(|e| e.to_string())?;
            }
        },
        "channel-seed" => {
            if state.events.lock().unwrap().iter().any(|event| matches!(event["value"]["action"].as_str(), Some("run" | "channel-seed"))) {
                return Err("Run the channel probe once, before boundary probes, on a fresh profile".into());
            }
            // The first large channel message has data ID 0 in this fresh webview's queue.
            // The shell fixture temporarily holds its event loop so auto-fetch cannot drain it.
            channel.ok_or("missing synthetic channel")?.channel_on::<_, String>(window.clone())
                .send("synthetic-channel-sentinel:".to_owned() + &"x".repeat(9000)).map_err(|e| e.to_string())?;
            for label in ["probe-a", "probe-b", "probe-control"] {
                if let Some(target) = probe_views(app).get(label).cloned() {
                    target.eval("void window.tryForeignChannel(0)").map_err(|e| e.to_string())?;
                }
            }
        },
        "busy" => probe_views(app).get("probe-a").cloned().ok_or("A already destroyed")?
            .eval("void window.startBusy()").map_err(|e| e.to_string())?,
        "stop" => if let Some(target) = probe_views(app).get("probe-a").cloned() {
            #[cfg(feature = "runtime-probe-receive")]
            app.run_on_main_thread(|| receive_boundary::remove("probe-a")).map_err(|e| e.to_string())?;
            #[cfg(feature = "runtime-probe-embedded")]
            target.close().map_err(|e| e.to_string())?;
            #[cfg(not(feature = "runtime-probe-embedded"))]
            target.window().destroy().map_err(|e| e.to_string())?;
        },
        "show-a" | "show-b" => {
            let selected = if action == "show-a" { "probe-a" } else { "probe-b" };
            for label in ["probe-a", "probe-b"] {
                if let Some(target) = probe_views(app).get(label) {
                    if label == selected { target.show() } else { target.hide() }.map_err(|e| e.to_string())?;
                }
            }
        },
        "status" => for target in probe_views(app).values() {
            target.eval("void window.reportMediaState?.()").map_err(|e| e.to_string())?;
        },
        _ => return Err("unknown probe action".into()),
    }
    #[allow(unused_mut)]
    let mut result = json!({"action": action, "elapsedMs": started.elapsed().as_millis(), "views": probe_views(app).keys().collect::<Vec<_>>(), "ticks": *state.ticks.lock().unwrap(), "admission": state.admission.snapshot()});
    #[cfg(feature = "runtime-probe-receive")]
    { result["receiving"] = state.receiving.snapshot(); }
    state.record("native", result.clone());
    Ok(result)
}

#[cfg(target_os = "macos")]
fn record_process_id(window: &Webview) {
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
fn record_process_id(_: &Webview) {}

fn receivers(app: &tauri::AppHandle, label: &str) -> (u16, u16, u16) {
    let tcp = TcpListener::bind("127.0.0.1:0").unwrap();
    let preconnect = TcpListener::bind("127.0.0.1:0").unwrap();
    let udp = UdpSocket::bind("127.0.0.1:0").unwrap();
    let http_port = tcp.local_addr().unwrap().port();
    let udp_port = udp.local_addr().unwrap().port();
    let preconnect_port = preconnect.local_addr().unwrap().port();
    for (kind, listener) in [("tcp", tcp), ("preconnect", preconnect)] {
    let handle = app.clone(); let owner = label.to_owned();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break; };
            stream.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
            let mut bytes = [0; 2048];
            let count = stream.read(&mut bytes).unwrap_or(0);
            let request = std::str::from_utf8(&bytes[..count]).unwrap_or("");
            let path = request.split_ascii_whitespace().nth(1).unwrap_or("");
            let route = ["/receiver-control", "/fetch", "/beacon", "/socket", "/image", "/frame", "/form", "/style", "/preload", "/prefetch", "/media", "/worker", "/eventsource", "/script", "/navigation"].into_iter().find(|candidate| *candidate == path).unwrap_or("unclassified");
            handle.state::<Probe>().record(&owner, json!({"received": kind, "route": route, "bytes": count, "positiveControl": bytes[..count].starts_with(b"GET /receiver-control ")}));
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
    });
    }
    let handle = app.clone(); let owner = label.to_owned();
    std::thread::spawn(move || {
        let mut bytes = [0; 2048];
        while let Ok((count, _)) = udp.recv_from(&mut bytes) {
            handle.state::<Probe>().record(&owner, json!({"received": "udp", "bytes": count, "positiveControl": &bytes[..count] == b"receiver-control"}));
        }
    });
    // Positive controls ensure that an empty receiver log is not mistaken for network denial.
    TcpStream::connect(("127.0.0.1", http_port)).unwrap().write_all(b"GET /receiver-control HTTP/1.0\r\n\r\n").unwrap();
    TcpStream::connect(("127.0.0.1", preconnect_port)).unwrap().write_all(b"GET /receiver-control HTTP/1.0\r\n\r\n").unwrap();
    UdpSocket::bind("127.0.0.1:0").unwrap().send_to(b"receiver-control", ("127.0.0.1", udp_port)).unwrap();
    (http_port, udp_port, preconnect_port)
}

fn silent_wav() -> Vec<u8> {
    let sample_bytes = 60u32 * 16_000; // One minute avoids end/loop timing ambiguity during UI checks.
    let mut data = b"RIFF".to_vec();
    data.extend((sample_bytes + 36).to_le_bytes()); data.extend(b"WAVEfmt "); data.extend(16u32.to_le_bytes());
    data.extend(1u16.to_le_bytes()); data.extend(1u16.to_le_bytes()); data.extend(8000u32.to_le_bytes());
    data.extend(16000u32.to_le_bytes()); data.extend(2u16.to_le_bytes()); data.extend(16u16.to_le_bytes());
    data.extend(b"data"); data.extend(sample_bytes.to_le_bytes()); data.resize(sample_bytes as usize + 44, 0); data
}

fn asset_response(owner: &str, path: &str) -> tauri::http::Response<Vec<u8>> {
    let (status, mime, data) = match path {
        "/index.html" => (200, "text/html", include_bytes!("capability_runtime_probe/assets/index.html").to_vec()),
        "/probe.js" => (200, "text/javascript", include_bytes!("capability_runtime_probe/assets/probe.js").to_vec()),
        "/extended-probe.js" => (200, "text/javascript", include_bytes!("capability_runtime_probe/assets/extended-probe.js").to_vec()),
        "/load-probe.js" => (200, "text/javascript", include_bytes!("capability_runtime_probe/assets/load-probe.js").to_vec()),
        "/ingress-probe.js" => (200, "text/javascript", include_bytes!("capability_runtime_probe/assets/ingress-probe.js").to_vec()),
        "/receive-probe.js" => (200, "text/javascript", include_bytes!("capability_runtime_probe/assets/receive-probe.js").to_vec()),
        "/service-worker.js" => (200, "text/javascript", b"/* Synthetic registration-only fixture; no persistent work. */".to_vec()),
        "/pixel.svg" => (200, "image/svg+xml", br##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#479"/></svg>"##.to_vec()),
        "/tone.wav" => (200, "audio/wav", silent_wav()),
        _ => (403, "text/plain", b"No package-private route".to_vec()),
    };
    let mut response = tauri::http::Response::builder().status(status).header("Content-Type", mime);
    // B is a native-only negative control; production policy still includes CSP.
    if !["probe-control", "probe-b"].contains(&owner) {
        response = response.header("Content-Security-Policy", "default-src 'none'; script-src nookiprobe:; style-src 'unsafe-inline'; connect-src nookiprobe: ipc: http://ipc.localhost; img-src nookiprobe:; media-src nookiprobe:; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    }
    response.body(data).unwrap()
}

fn main() {
    assert!(cfg!(target_os = "macos"), "This experiment currently measures macOS only");
    let root = PathBuf::from(std::env::var_os("NOOKI_TEST_PROFILE").expect("Use the isolated profile launcher"));
    let mut context = tauri::generate_context!("examples/capability_runtime_probe/tauri.conf.json");
    app_profile::configure(context.config_mut(), |key| std::env::var_os(key)).expect("isolated profile configuration");
    tauri::Builder::default()
        .manage(Probe { root, started: Instant::now(), events: Mutex::new(Vec::new()), ticks: Mutex::new(BTreeMap::new()), admission: admission::Admission::default(),
            #[cfg(feature = "runtime-probe-receive")]
            receiving: admission::Admission::default(),
            #[cfg(feature = "runtime-probe-receive")]
            receive_rate: receive_policy::Rate::default(),
        })
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            // Observe the already-decoded synthetic message; do not grant the command.
            if invoke.message.command() == "probe_ingress" {
                if let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() {
                    let view = invoke.message.webview_ref();
                    view.state::<Probe>().record(view.label(), json!({"transportIngress":"application-dispatch", "decodedPayloadBytes":value["payload"].as_str().map(str::len)}));
                }
            }
            if !policy::command_allowed(invoke.message.webview_ref().label(), invoke.message.command()) {
                invoke.resolver.reject("command not exposed to this runtime");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![probe_rpc, probe_identity, probe_load, probe_unguarded, probe_host_secret, probe_report, probe_tick, probe_control];
            handler(invoke)
        })
        .register_uri_scheme_protocol("nookiprobe", |ctx, request| {
            if request.uri().path() == "/budget-ingress" {
                ctx.app_handle().state::<Probe>().record(ctx.webview_label(), json!({"transportIngress":"custom-protocol", "requestBodyBytes":request.body().len(), "method":request.method().as_str()}));
            }
            asset_response(ctx.webview_label(), request.uri().path())
        })
        .setup(|app| {
            #[cfg(feature = "runtime-probe-embedded")]
            let workspace = tauri::WindowBuilder::new(app, "probe-workspace")
                .title("Nooki Runtime Probe — embedded workspace").inner_size(1200.0, 800.0)
                .position(80.0, 80.0).build()?;
            for (_index, label) in ["probe-shell", "probe-a", "probe-b", "probe-control", "probe-unavailable"].iter().enumerate() {
                let (http_port, udp_port, preconnect_port) = receivers(app.handle(), label);
                let navigation_app = app.handle().clone(); let owner = label.to_string();
                let popup_app = app.handle().clone(); let popup_owner = label.to_string();
                #[cfg(target_os = "macos")]
                let (configuration, ready, policy) = native_configuration::prepare(label);
                #[cfg(feature = "runtime-probe-receive")]
                receive_boundary::prepare(&configuration, app.handle(), label);
                #[cfg(target_os = "macos")]
                app.state::<Probe>().record(label, json!({"enginePolicy": policy}));
                #[cfg(not(feature = "runtime-probe-embedded"))]
                let builder = tauri::WebviewWindowBuilder::new(app, *label, tauri::WebviewUrl::External("about:blank".parse()?))
                    .title(format!("Nooki Runtime Probe — {label}"))
                    .inner_size(640.0, 700.0).position(80.0 + _index as f64 * 80.0, 80.0 + _index as f64 * 35.0);
                #[cfg(feature = "runtime-probe-embedded")]
                let builder = tauri::webview::WebviewBuilder::new(*label, tauri::WebviewUrl::External("about:blank".parse()?));
                let builder = builder.incognito(true)
                    .initialization_script(format!("window.PROBE = {};", json!({"label": label, "httpPort": http_port, "udpPort": udp_port, "preconnectPort": preconnect_port, "embedded": cfg!(feature = "runtime-probe-embedded"), "hostWindow": if cfg!(feature = "runtime-probe-embedded") { "probe-workspace" } else { "probe-shell" }})))
                    .on_navigation(move |url| {
                        let allowed = matches!(url.as_str(), "about:blank" | "nookiprobe://localhost/index.html")
                            || (owner == "probe-control" && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(http_port));
                        if !allowed { navigation_app.state::<Probe>().record(&owner, json!({"navigationDenied": true})); }
                        allowed
                    })
                    .on_new_window(move |_, _| {
                        popup_app.state::<Probe>().record(&popup_owner, json!({"popupDenied": true}));
                        tauri::webview::NewWindowResponse::Deny
                    });
                #[cfg(target_os = "macos")]
                let builder = builder.with_webview_configuration(configuration);
                #[cfg(not(feature = "runtime-probe-embedded"))]
                let window = builder.build()?;
                #[cfg(feature = "runtime-probe-embedded")]
                let window = {
                    let shared = ["probe-shell", "probe-a", "probe-b"].contains(label);
                    let parent = if shared { workspace.clone() } else {
                        tauri::WindowBuilder::new(app, format!("{label}-window"))
                            .title(format!("Nooki Runtime Probe — {label}"))
                            .inner_size(640.0, 700.0).position(160.0, 120.0).build()?
                    };
                    let (left, width, height) = if *label == "probe-shell" { (0.0, 400.0, 800.0) }
                        else if shared { (400.0, 800.0, 800.0) } else { (0.0, 640.0, 700.0) };
                    let view = parent.add_child(builder, tauri::LogicalPosition::new(left, 0.0), tauri::LogicalSize::new(width, height))?;
                    if *label == "probe-b" { view.hide()?; }
                    view
                };
                #[cfg(target_os = "macos")]
                if ready {
                    #[cfg(feature = "runtime-probe-receive")]
                    if matches!(*label, "probe-a" | "probe-b") {
                        window.with_webview(move |native| {
                            receive_boundary::remove_post_message(native.inner());
                        })?;
                    }
                    window.navigate("nookiprobe://localhost/index.html".parse()?)?;
                }
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
