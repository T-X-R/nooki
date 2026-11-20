//! Opt-in macOS receive experiment. Native objects stay on the main thread.
use super::{receive_policy as policy, Probe};
use std::{cell::{Cell, RefCell}, collections::HashMap, io::Read, ptr::NonNull, rc::Rc, time::Instant};
use objc2::{define_class, msg_send, AllocAnyThread, DeclaredClass, MainThreadMarker, MainThreadOnly, Message, rc::Retained, runtime::ProtocolObject};
use objc2_foundation::{NSData, NSHTTPURLResponse, NSInputStream, NSMutableDictionary, NSObject, NSObjectProtocol, NSStreamStatus, NSString, NSURLRequest, NSUTF8StringEncoding};
use objc2_web_kit::{WKURLSchemeHandler, WKURLSchemeTask, WKWebView, WKWebViewConfiguration};
use serde_json::json;
use tauri::{Manager, ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody}, webview::InvokeRequest};

type Reply = tauri::http::Response<Vec<u8>>;
struct Completion {
    app: tauri::AppHandle, owner: String, generation: usize, id: u64,
    permit: Option<super::admission::Permit>,
}
impl Completion {
    fn finish(mut self, response: Reply) { self.dispatch(response); }
    fn dispatch(&mut self, response: Reply) {
        let permit = self.permit.take();
        let owner = self.owner.clone(); let generation = self.generation; let id = self.id;
        let _ = self.app.run_on_main_thread(move || {
            let _held = permit;
            HANDLERS.with(|handlers| {
                let handler = handlers.borrow().get(&owner).cloned();
                if let Some(handler) = handler.filter(|handler| handler.ivars().generation == generation) { handler.finish(id, response); }
            });
        });
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        if self.permit.is_some() {
            self.app.state::<Probe>().record(&self.owner, json!({"receiveBoundary":"abandoned-response"}));
            self.dispatch(reply(400, "request abandoned by dispatcher"));
        }
    }
}
#[derive(Clone)]
struct Pending { task: Retained<ProtocolObject<dyn WKURLSchemeTask>>, stopped: Rc<Cell<bool>> }
pub struct Ivars {
    app: tauri::AppHandle,
    owner: String,
    generation: usize,
    serial: Cell<u64>,
    pending: RefCell<HashMap<u64, Pending>>,
}
thread_local! { static HANDLERS: RefCell<HashMap<String, Retained<Receiver>>> = RefCell::new(HashMap::new()); }

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Ivars]
    pub struct Receiver;
    unsafe impl NSObjectProtocol for Receiver {}
    unsafe impl WKURLSchemeHandler for Receiver {
        #[unsafe(method(webView:startURLSchemeTask:))]
        fn start(&self, _view: &WKWebView, task: &ProtocolObject<dyn WKURLSchemeTask>) {
            let id = self.ivars().serial.get(); self.ivars().serial.set(id + 1);
            self.ivars().pending.borrow_mut().insert(id, Pending { task:task.retain(), stopped:Rc::new(Cell::new(false)) });
            if let Err(reason) = self.receive(id, task) {
                let state = self.ivars().app.state::<Probe>();
                let count = state.receive_rejections.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                // Preserve control/peer evidence in the probe's 256-event diagnostic cap.
                if count <= 16 || count % 64 == 0 {
                    state.record(&self.ivars().owner, json!({"receiveBoundary":"rejected-before-dispatch","reason":reason,"totalRejections":count}));
                }
                self.finish(id, reply(413, &reason));
            }
        }
        #[unsafe(method(webView:stopURLSchemeTask:))]
        fn stop(&self, _view: &WKWebView, task: &ProtocolObject<dyn WKURLSchemeTask>) {
            let key = task as *const _ as usize;
            let mut cancelled = false;
            self.ivars().pending.borrow_mut().retain(|_, pending| {
                if (&*pending.task) as *const _ as usize == key { pending.stopped.set(true); cancelled = true; false } else { true }
            });
            if cancelled { self.ivars().app.state::<Probe>().record(&self.ivars().owner, json!({"receiveBoundary":"cancelled"})); }
        }
    }
);

fn bounded(value: &NSString, max: usize) -> Result<String, String> {
    // First bound UTF-16 scanning work, then exact UTF-8 bytes before to_string.
    if value.length() > max || value.lengthOfBytesUsingEncoding(NSUTF8StringEncoding) > max { return Err("request metadata too large".into()); }
    Ok(value.to_string())
}

struct BodyStream(Retained<NSInputStream>);
impl Read for BodyStream {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() { return Ok(0); }
        if self.0.streamStatus() == NSStreamStatus::AtEnd { return Ok(0); }
        if !self.0.hasBytesAvailable() { return Err(std::io::Error::other("native body stream unavailable")); }
        let count = unsafe { self.0.read_maxLength(NonNull::new(buffer.as_mut_ptr()).unwrap(), buffer.len()) };
        if count < 0 { Err(std::io::Error::other("native body stream failed")) } else { Ok(count as usize) }
    }
}
impl Drop for BodyStream { fn drop(&mut self) { self.0.close(); } }

fn body(request: &NSURLRequest) -> Result<Vec<u8>, String> {
    if let Some(data) = request.HTTPBody() {
        if data.len() > policy::BODY_BYTES { return Err("request body too large".into()); }
        return Ok(data.to_vec());
    }
    if let Some(stream) = request.HTTPBodyStream() {
        stream.open();
        return policy::read_body(BodyStream(stream));
    }
    Ok(Vec::new())
}

fn reply(status: u16, reason: &str) -> Reply {
    tauri::http::Response::builder().status(status).header("Content-Type", "text/plain")
        .header("Tauri-Response", "error").body(reason.as_bytes().to_vec()).unwrap()
}

impl Receiver {
    fn receive(&self, id: u64, task: &ProtocolObject<dyn WKURLSchemeTask>) -> Result<(), String> {
        let state = self.ivars().app.state::<Probe>();
        state.receive_rate.check(&self.ivars().owner, Instant::now()).map_err(str::to_owned)?;
        // Reserve the maximum copy before looking at any package-supplied metadata/body.
        let permit = state.receiving.acquire(&self.ivars().owner, policy::BODY_BYTES).map_err(str::to_owned)?;
        let request = unsafe { task.request() };
        let native_url = request.URL().ok_or("missing request URL")?;
        let url = tauri::Url::parse(&bounded(&*native_url.absoluteString().ok_or("missing URL string")?, policy::URL_BYTES)?).map_err(|_| "invalid request URL")?;
        let method = bounded(&*request.HTTPMethod().ok_or("missing request method")?, 16)?;
        let mut headers = tauri::http::HeaderMap::new();
        if let Some(fields) = request.allHTTPHeaderFields() {
            if fields.count() > 32 { return Err("too many request headers".into()); }
            let mut total = 0;
            for key in fields.allKeys().iter() {
                let value = fields.objectForKey(&key).ok_or("missing header value")?;
                let name = bounded(&key, 128)?; let value = bounded(&value, 4096)?;
                total += name.len() + value.len();
                if total > policy::HEADER_BYTES { return Err("request headers too large".into()); }
                headers.insert(tauri::http::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| "invalid header name")?, value.parse().map_err(|_| "invalid header value")?);
            }
        }
        if method == "OPTIONS" { self.finish(id, reply(200, "")); return Ok(()); }
        if url.scheme() != "ipc" {
            if method != "GET" && method != "HEAD" { return Err("resource method not allowed".into()); }
            if request.HTTPBody().is_some_and(|data| !data.is_empty()) || request.HTTPBodyStream().is_some() { return Err("resource body not allowed".into()); }
            if url.scheme() == "nookiprobe" && url.path() == "/receive-delay" {
                let completion = Completion { app:self.ivars().app.clone(), owner:self.ivars().owner.clone(), generation:self.ivars().generation, id, permit:Some(permit) };
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    completion.finish(reply(200, "delayed response"));
                });
                return Ok(());
            }
            self.finish(id, if url.scheme() == "nookiprobe" { super::asset_response(&self.ivars().owner, url.path()) } else { reply(403, "No resource route") });
            return Ok(());
        }
        if method != "POST" { return Err("IPC method not allowed".into()); }
        let bytes = body(&request)?;
        let body_bytes = bytes.len();
        let payload = match headers.get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("") {
            "application/json" => InvokeBody::Json(serde_json::from_slice(&bytes).map_err(|_| "invalid JSON request")?),
            "application/octet-stream" => InvokeBody::Raw(bytes),
            _ => return Err("unsupported request content type".into()),
        };
        let command = percent_encoding::percent_decode_str(url.path().trim_start_matches('/')).decode_utf8().map_err(|_| "invalid command encoding")?.into_owned();
        if !matches!(command.as_str(), "probe_tick" | "probe_report") {
            state.record(&self.ivars().owner, json!({"receiveBoundary":"bounded-decode", "bodyBytes":body_bytes, "command":command}));
        }
        let value = |name| headers.get(name).and_then(|value| value.to_str().ok()).ok_or("missing IPC header");
        let view = self.ivars().app.get_webview(&self.ivars().owner).ok_or("runtime removed")?;
        let invoke = InvokeRequest { cmd:command, callback:CallbackFn(value("tauri-callback")?.parse().map_err(|_| "invalid callback")?), error:CallbackFn(value("tauri-error")?.parse().map_err(|_| "invalid error callback")?), url:view.url().map_err(|_| "runtime URL unavailable")?, body:payload, invoke_key:value("tauri-invoke-key")?.into(), headers };
        let completion = Completion { app:self.ivars().app.clone(), owner:self.ivars().owner.clone(), generation:self.ivars().generation, id, permit:Some(permit) };
        view.on_message(invoke, Box::new(move |_, _, response, _, _| {
            let response = match response {
                InvokeResponse::Ok(InvokeResponseBody::Json(value)) => tauri::http::Response::builder().header("Content-Type", "application/json").header("Tauri-Response", "ok").body(value.into_bytes()).unwrap(),
                InvokeResponse::Ok(InvokeResponseBody::Raw(value)) => tauri::http::Response::builder().header("Content-Type", "application/octet-stream").header("Tauri-Response", "ok").body(value).unwrap(),
                InvokeResponse::Err(_) => reply(400, "host operation refused"),
            };
            let response = if response.body().len() > policy::BODY_BYTES { reply(413, "response too large") } else { response };
            completion.finish(response);
        }));
        Ok(())
    }

    fn finish(&self, id: u64, response: Reply) {
        let pending = self.ivars().pending.borrow().get(&id).cloned();
        if let Some(pending) = pending {
            let task = &pending.task;
            unsafe {
                let url = task.request().URL().unwrap();
                let headers = NSMutableDictionary::new();
                headers.insert(&*NSString::from_str("Content-Length"), &*NSString::from_str(&response.body().len().to_string()));
                for (name, value) in response.headers() { headers.insert(&*NSString::from_str(name.as_str()), &*NSString::from_str(value.to_str().unwrap())); }
                for (name, value) in [("Access-Control-Allow-Origin", "*"), ("Access-Control-Allow-Headers", "*"), ("Access-Control-Expose-Headers", "Tauri-Response")] { headers.insert(&*NSString::from_str(name), &*NSString::from_str(value)); }
                let native = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(NSHTTPURLResponse::alloc(), &url, response.status().as_u16() as isize, Some(&NSString::from_str("HTTP/1.1")), Some(&headers)).unwrap();
                if !pending.stopped.get() { task.didReceiveResponse(&native); }
                if !pending.stopped.get() { task.didReceiveData(&NSData::with_bytes(response.body())); }
                if !pending.stopped.get() { task.didFinish(); }
            }
            self.ivars().pending.borrow_mut().remove(&id);
        } else {
            self.ivars().app.state::<Probe>().record(&self.ivars().owner, json!({"receiveBoundary":"late-response-discarded"}));
        }
    }
}

pub fn prepare(config: &WKWebViewConfiguration, app: &tauri::AppHandle, owner: &str) {
    if !matches!(owner, "probe-a" | "probe-b") { return; }
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let allocated = MainThreadMarker::new().unwrap().alloc::<Receiver>().set_ivars(Ivars { app:app.clone(), owner:owner.into(), generation:NEXT.fetch_add(1, Ordering::Relaxed), serial:Cell::new(0), pending:RefCell::new(HashMap::new()) });
    let handler: Retained<Receiver> = unsafe { msg_send![super(allocated), init] };
    for scheme in ["ipc", "nookiprobe", "tauri"] { unsafe { config.setURLSchemeHandler_forURLScheme(Some(ProtocolObject::from_ref(&*handler)), &NSString::from_str(scheme)); } }
    HANDLERS.with(|handlers| handlers.borrow_mut().insert(owner.into(), handler));
}

pub fn remove_post_message(native: *mut std::ffi::c_void) {
    let view = unsafe { &*(native as *const WKWebView) };
    unsafe { view.configuration().userContentController().removeScriptMessageHandlerForName(&NSString::from_str("ipc")); }
}

pub fn remove(owner: &str) {
    HANDLERS.with(|handlers| { if let Some(handler) = handlers.borrow_mut().remove(owner) { for pending in handler.ivars().pending.borrow().values() { pending.stopped.set(true); } handler.ivars().pending.borrow_mut().clear(); } });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_strings_are_checked_by_utf8_bytes_before_copying() {
        assert_eq!(bounded(&NSString::from_str("éé"), 4).unwrap(), "éé");
        assert!(bounded(&NSString::from_str("ééé"), 4).is_err());
    }
    #[test]
    fn native_memory_streams_obey_the_byte_boundary() {
        for length in [policy::BODY_BYTES, policy::BODY_BYTES + 1] {
            let stream = NSInputStream::initWithData(NSInputStream::alloc(), &NSData::with_bytes(&vec![42; length]));
            stream.open();
            let result = policy::read_body(BodyStream(stream));
            if length == policy::BODY_BYTES { assert_eq!(result.unwrap(), vec![42; length]); }
            else { assert!(result.is_err()); }
        }
    }
}
