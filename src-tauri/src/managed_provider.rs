use serde::{Deserialize, Serialize};
use std::{
  collections::HashMap,
  future::Future,
  path::Path,
  sync::atomic::{AtomicU64, Ordering},
  time::{Duration, Instant},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const CONNECT_ATTEMPTS: usize = 3;
const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_MAX_TOKENS: u32 = 8192;
const MAX_VENDOR_DETAIL: usize = 200;
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// The request shape a Provider endpoint understands. One managed adapter
/// serves every endpoint so credentials never leave the desktop host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireApi {
  /// OpenAI Responses API, used by Codex API profiles.
  Responses,
  /// OpenAI Chat Completions API, used by DeepSeek, Kimi, Qwen and friends.
  Chat,
  /// Anthropic Messages API, used by Claude.
  Anthropic,
}

impl WireApi {
  pub fn parse(value: &str) -> Option<Self> {
    match value {
      "responses" => Some(Self::Responses),
      "chat" | "chat-completions" => Some(Self::Chat),
      "anthropic" | "messages" => Some(Self::Anthropic),
      _ => None,
    }
  }

  pub fn as_str(self) -> &'static str {
    match self {
      Self::Responses => "responses",
      Self::Chat => "chat",
      Self::Anthropic => "anthropic",
    }
  }

  fn path_suffix(self) -> &'static str {
    match self {
      Self::Responses => "responses",
      Self::Chat => "chat/completions",
      Self::Anthropic => "messages",
    }
  }
}

#[derive(Clone)]
pub struct ManagedProvider {
  pub name: String,
  pub model: String,
  reasoning_effort: Option<String>,
  base_url: String,
  bearer_token: String,
  wire_api: WireApi,
}

impl ManagedProvider {
  /// Builds a Provider from user-configured endpoint settings. The credential
  /// stays inside this struct and is never serialized back to the interface.
  pub fn new(
    name: String,
    model: String,
    base_url: String,
    bearer_token: String,
    wire_api: WireApi,
    reasoning_effort: Option<String>,
  ) -> Self {
    Self { name, model, reasoning_effort, base_url, bearer_token, wire_api }
  }
}

#[derive(Debug, Serialize)]
pub struct ModelResult {
  pub provider: String,
  pub model: String,
  pub output: String,
}

#[derive(Deserialize)]
struct CodexProfile {
  model_provider: String,
  model: String,
  model_reasoning_effort: Option<String>,
  model_providers: HashMap<String, CodexProvider>,
}

#[derive(Deserialize)]
struct CodexProvider {
  name: Option<String>,
  wire_api: Option<String>,
  base_url: String,
  env_key: Option<String>,
  experimental_bearer_token: Option<String>,
}

pub fn load_codex_api_profile(codex_home: &Path) -> Result<ManagedProvider, String> {
  let profile_path = codex_home.join("api.config.toml");
  let source = std::fs::read_to_string(&profile_path)
    .map_err(|_| "未找到或无法读取 ~/.codex/api.config.toml".to_string())?;

  parse_codex_api_profile(&source)
}

fn parse_codex_api_profile(source: &str) -> Result<ManagedProvider, String> {
  let profile: CodexProfile =
    toml::from_str(source).map_err(|_| "API 配置文件格式无效".to_string())?;
  let provider = profile
    .model_providers
    .get(&profile.model_provider)
    .ok_or_else(|| "API 配置引用的 model_provider 不存在".to_string())?;

  if profile.model.trim().is_empty() {
    return Err("API 配置缺少 model".into());
  }
  if provider.base_url.trim().is_empty() {
    return Err("API 配置缺少 base_url".into());
  }
  if provider.wire_api.as_deref() != Some("responses") {
    return Err("当前仅支持 wire_api = \"responses\"".into());
  }

  let bearer_token = resolve_bearer_token(provider)?;
  let name = provider
    .name
    .as_deref()
    .filter(|name| !name.trim().is_empty())
    .unwrap_or(&profile.model_provider)
    .to_string();

  Ok(ManagedProvider {
    name,
    model: profile.model,
    reasoning_effort: profile.model_reasoning_effort,
    base_url: provider.base_url.clone(),
    bearer_token,
    wire_api: WireApi::Responses,
  })
}

fn resolve_bearer_token(provider: &CodexProvider) -> Result<String, String> {
  if let Some(env_key) = provider.env_key.as_deref().filter(|key| !key.trim().is_empty()) {
    return std::env::var(env_key)
      .ok()
      .filter(|value| !value.trim().is_empty())
      .ok_or_else(|| format!("桌面宿主未获取到环境变量 {env_key}"));
  }

  provider
    .experimental_bearer_token
    .clone()
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| "API 配置缺少可用凭据".to_string())
}

pub async fn invoke(provider: ManagedProvider, input: &str) -> Result<ModelResult, String> {
  let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
  let started = Instant::now();
  log::info!(
    target: "workbench::provider",
    "request.start id={request_id} provider={} model={} input_bytes={} timeout_ms={}",
    provider.name,
    provider.model,
    input.len(),
    REQUEST_TIMEOUT.as_millis(),
  );
  let client = reqwest::Client::builder()
    // This Provider gateway closes Rustls handshakes before HTTP begins.
    // The platform-native TLS backend matches curl and the desktop environment.
    .use_native_tls()
    .timeout(REQUEST_TIMEOUT)
    .build()
    .map_err(|_| {
      log::error!(target: "workbench::provider", "request.error id={request_id} stage=client_init");
      "无法初始化 Provider 连接".to_string()
    })?;
  invoke_with_client(&client, provider, input, request_id, started).await
}

async fn invoke_with_client(
  client: &reqwest::Client,
  provider: ManagedProvider,
  input: &str,
  request_id: u64,
  started: Instant,
) -> Result<ModelResult, String> {
  let url = endpoint_url(&provider.base_url, provider.wire_api)?;
  let payload = request_payload(&provider, input);

  let response = retry_connect_failures(
    || {
      let request = client.post(url.clone());
      let request = match provider.wire_api {
        // Anthropic authenticates with a dedicated header and a pinned version.
        WireApi::Anthropic => request
          .header("x-api-key", provider.bearer_token.as_str())
          .header("anthropic-version", ANTHROPIC_VERSION),
        _ => request.bearer_auth(&provider.bearer_token),
      };
      request.json(&payload).send()
    },
    reqwest::Error::is_connect,
  )
  .await
  .map_err(|error| {
    let kind = request_error_kind(&error);
    log::warn!(
      target: "workbench::provider",
      "request.error id={request_id} stage=send kind={kind} elapsed_ms={}",
      started.elapsed().as_millis(),
    );
    if error.is_connect() {
      "无法连接 Provider 端点（TLS 或网络握手失败，已重试）".to_string()
    } else if error.is_timeout() {
      "连接 Provider 端点超时".to_string()
    } else {
      "Provider 请求发送失败".to_string()
    }
  })?;

  let status = response.status();
  let content_type = response
    .headers()
    .get("content-type")
    .and_then(|value| value.to_str().ok())
    .unwrap_or("missing")
    .to_string();
  let content_encoding = response
    .headers()
    .get("content-encoding")
    .and_then(|value| value.to_str().ok())
    .unwrap_or("identity")
    .to_string();
  log::info!(
    target: "workbench::provider",
    "response.headers id={request_id} status={} type={content_type} encoding={content_encoding} elapsed_ms={}",
    status.as_u16(),
    started.elapsed().as_millis(),
  );
  if !status.is_success() {
    // The vendor usually explains the refusal better than the status code does,
    // for instance an unknown model name. Pass that sentence through.
    let vendor = failure_detail(response, &provider.bearer_token).await;
    log::warn!(
      target: "workbench::provider",
      "request.error id={request_id} stage=http_status status={} detail={vendor:?} elapsed_ms={}",
      status.as_u16(),
      started.elapsed().as_millis(),
    );
    let base = match status.as_u16() {
      401 | 403 => "Provider 拒绝了当前凭据".to_string(),
      404 => "Provider 未找到配置的端点路径".to_string(),
      429 => "Provider 当前请求过多或额度不足".to_string(),
      code => format!("Provider 请求失败（HTTP {code}）"),
    };
    return Err(if vendor.is_empty() { base } else { format!("{base} · {vendor}") });
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|error| {
      let kind = request_error_kind(&error);
      log::warn!(
        target: "workbench::provider",
        "request.error id={request_id} stage=body kind={kind} type={content_type} encoding={content_encoding} elapsed_ms={}",
        started.elapsed().as_millis(),
      );
      if error.is_timeout() {
        "Provider 生成响应超时".to_string()
      } else {
        "读取 Provider 响应失败".to_string()
      }
    })?;
  let body: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
    let shape = response_shape(&bytes);
    log::warn!(
      target: "workbench::provider",
      "request.error id={request_id} stage=json_parse type={content_type} encoding={content_encoding} response_bytes={} shape={shape} elapsed_ms={}",
      bytes.len(),
      started.elapsed().as_millis(),
    );
    "Provider 返回了无法解析的响应".to_string()
  })?;
  let output = extract_output_text(&body, provider.wire_api).ok_or_else(|| {
    log::warn!(
      target: "workbench::provider",
      "request.error id={request_id} stage=output_extract response_bytes={} elapsed_ms={}",
      bytes.len(),
      started.elapsed().as_millis(),
    );
    "Provider 响应中没有文本结果".to_string()
  })?;

  log::info!(
    target: "workbench::provider",
    "request.complete id={request_id} response_bytes={} output_bytes={} elapsed_ms={}",
    bytes.len(),
    output.len(),
    started.elapsed().as_millis(),
  );

  Ok(ModelResult {
    provider: provider.name,
    model: provider.model,
    output,
  })
}

/// Reads the vendor explanation out of a refused request. Anything resembling
/// a credential is removed before the sentence reaches a log or the interface.
async fn failure_detail(response: reqwest::Response, secret: &str) -> String {
  let Ok(bytes) = response.bytes().await else { return String::new() };
  let text = match serde_json::from_slice::<serde_json::Value>(&bytes) {
    Ok(body) => vendor_message(&body).unwrap_or_default(),
    Err(_) => String::from_utf8_lossy(&bytes).into_owned(),
  };
  let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
  if collapsed.is_empty() || collapsed.starts_with('<') {
    return String::new();
  }
  let redacted = redact(&collapsed, secret);
  match redacted.char_indices().nth(MAX_VENDOR_DETAIL) {
    Some((index, _)) => format!("{}…", &redacted[..index]),
    None => redacted,
  }
}

fn vendor_message(body: &serde_json::Value) -> Option<String> {
  ["/error/message", "/message", "/error", "/detail"]
    .into_iter()
    .find_map(|pointer| body.pointer(pointer).and_then(serde_json::Value::as_str))
    .map(str::to_string)
}

fn redact(text: &str, secret: &str) -> String {
  let text = if secret.chars().count() >= 8 { text.replace(secret, "[redacted]") } else { text.to_string() };
  text
    .split(' ')
    .map(|word| if word.len() > 12 && word.contains("sk-") { "[redacted]" } else { word })
    .collect::<Vec<_>>()
    .join(" ")
}

fn request_error_kind(error: &reqwest::Error) -> &'static str {
  if error.is_timeout() {
    "timeout"
  } else if error.is_decode() {
    "decode"
  } else if error.is_body() {
    "body"
  } else if error.is_connect() {
    "connect"
  } else {
    "other"
  }
}

async fn retry_connect_failures<T, E, Request, RequestFuture, ShouldRetry>(
  mut request: Request,
  should_retry: ShouldRetry,
) -> Result<T, E>
where
  Request: FnMut() -> RequestFuture,
  RequestFuture: Future<Output = Result<T, E>>,
  ShouldRetry: Fn(&E) -> bool,
{
  for attempt in 1..=CONNECT_ATTEMPTS {
    match request().await {
      Ok(value) => return Ok(value),
      Err(error) if attempt < CONNECT_ATTEMPTS && should_retry(&error) => continue,
      Err(error) => return Err(error),
    }
  }
  unreachable!("the retry loop always returns")
}

fn request_payload(provider: &ManagedProvider, input: &str) -> serde_json::Value {
  let effort = provider
    .reasoning_effort
    .as_deref()
    .map(str::trim)
    .filter(|effort| !effort.is_empty());

  match provider.wire_api {
    WireApi::Responses => {
      let mut payload = serde_json::json!({ "model": provider.model, "input": input });
      if let Some(effort) = effort {
        payload["reasoning"] = serde_json::json!({ "effort": effort });
      }
      payload
    }
    WireApi::Chat => serde_json::json!({
      "model": provider.model,
      "messages": [{ "role": "user", "content": input }],
      "stream": false,
    }),
    WireApi::Anthropic => serde_json::json!({
      "model": provider.model,
      "max_tokens": ANTHROPIC_MAX_TOKENS,
      "messages": [{ "role": "user", "content": [{ "type": "text", "text": input }] }],
    }),
  }
}

pub fn endpoint_url(base_url: &str, wire_api: WireApi) -> Result<reqwest::Url, String> {
  let mut url = reqwest::Url::parse(base_url)
    .map_err(|_| "API 配置中的 base_url 无效".to_string())?;
  if !matches!(url.scheme(), "http" | "https") || url.username() != "" || url.password().is_some() {
    return Err("API 配置中的 base_url 无效".into());
  }
  if url.query().is_some() || url.fragment().is_some() {
    return Err("API 配置中的 base_url 不能包含查询参数或片段".into());
  }

  let suffix = wire_api.path_suffix();
  let path = url.path().trim_end_matches('/');
  if !path.ends_with(&format!("/{suffix}")) {
    url.set_path(&format!("{path}/{suffix}"));
  }
  Ok(url)
}

fn extract_output_text(body: &serde_json::Value, wire_api: WireApi) -> Option<String> {
  match wire_api {
    WireApi::Responses => extract_responses_text(body),
    WireApi::Chat => extract_chat_text(body),
    WireApi::Anthropic => extract_anthropic_text(body),
  }
}

fn extract_chat_text(body: &serde_json::Value) -> Option<String> {
  let message = body.get("choices")?.as_array()?.first()?.get("message")?;
  if let Some(content) = message.get("content").and_then(serde_json::Value::as_str) {
    if !content.trim().is_empty() {
      return Some(content.to_string());
    }
  }
  // Some gateways return structured content parts instead of a plain string.
  let parts = message.get("content")?.as_array()?;
  let text = parts
    .iter()
    .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
    .collect::<Vec<_>>()
    .join("");
  (!text.trim().is_empty()).then_some(text)
}

fn extract_anthropic_text(body: &serde_json::Value) -> Option<String> {
  let text = body
    .get("content")?
    .as_array()?
    .iter()
    .filter(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("text"))
    .filter_map(|block| block.get("text").and_then(serde_json::Value::as_str))
    .collect::<Vec<_>>()
    .join("");
  (!text.trim().is_empty()).then_some(text)
}

fn extract_responses_text(body: &serde_json::Value) -> Option<String> {
  if let Some(output) = body.get("output_text").and_then(serde_json::Value::as_str) {
    return Some(output.to_string());
  }

  body
    .get("output")?
    .as_array()?
    .iter()
    .flat_map(|item| item.get("content").and_then(serde_json::Value::as_array).into_iter().flatten())
    .find_map(|content| {
      (content.get("type").and_then(serde_json::Value::as_str) == Some("output_text"))
        .then(|| content.get("text").and_then(serde_json::Value::as_str))
        .flatten()
        .map(str::to_string)
    })
}

fn response_shape(bytes: &[u8]) -> &'static str {
  if bytes.is_empty() {
    return "empty";
  }
  if bytes.starts_with(&[0x1f, 0x8b]) {
    return "gzip-bytes";
  }
  let Ok(text) = std::str::from_utf8(bytes) else {
    return "non-utf8";
  };
  let text = text.trim_start_matches(['\u{feff}', ' ', '\t', '\r', '\n']);
  if text.starts_with("event:") || text.starts_with("data:") {
    "event-stream"
  } else if text.starts_with("<!DOCTYPE html") || text.starts_with("<!doctype html") || text.starts_with("<html") {
    "html"
  } else if text.starts_with('{') || text.starts_with('[') {
    "incomplete-json"
  } else {
    "other-text"
  }
}

#[cfg(test)]
mod tests {
  use super::{
    endpoint_url, extract_output_text, invoke, request_payload, retry_connect_failures,
    ManagedProvider, WireApi, CONNECT_ATTEMPTS, REQUEST_TIMEOUT,
  };
  use std::cell::Cell;
  use std::io::{Read, Write};
  use std::time::Duration;

  #[derive(Debug, PartialEq, Eq)]
  struct TestError {
    retryable: bool,
  }

  fn provider(wire_api: WireApi) -> ManagedProvider {
    ManagedProvider::new(
      "Vendor".into(),
      "model-1".into(),
      "https://api.example.com/v1".into(),
      "sk-test".into(),
      wire_api,
      None,
    )
  }

  #[test]
  fn each_wire_api_targets_its_own_path() {
    let cases = [
      (WireApi::Responses, "https://api.example.com/v1/responses"),
      (WireApi::Chat, "https://api.example.com/v1/chat/completions"),
      (WireApi::Anthropic, "https://api.example.com/v1/messages"),
    ];
    for (wire_api, expected) in cases {
      assert_eq!(endpoint_url("https://api.example.com/v1", wire_api).unwrap().as_str(), expected);
      // An endpoint that already names the path is kept as configured.
      assert_eq!(endpoint_url(expected, wire_api).unwrap().as_str(), expected);
    }
    assert!(endpoint_url("ftp://api.example.com", WireApi::Chat).is_err());
    assert!(endpoint_url("https://api.example.com/v1?key=1", WireApi::Chat).is_err());
  }

  #[test]
  fn each_wire_api_sends_and_reads_its_own_shape() {
    let responses = request_payload(&provider(WireApi::Responses), "hello");
    assert_eq!(responses["input"], "hello");
    let chat = request_payload(&provider(WireApi::Chat), "hello");
    assert_eq!(chat["messages"][0]["content"], "hello");
    let anthropic = request_payload(&provider(WireApi::Anthropic), "hello");
    assert_eq!(anthropic["messages"][0]["content"][0]["text"], "hello");
    assert!(anthropic["max_tokens"].is_number());

    let chat_body = serde_json::json!({ "choices": [{ "message": { "content": "done" } }] });
    assert_eq!(extract_output_text(&chat_body, WireApi::Chat).as_deref(), Some("done"));
    let chat_parts = serde_json::json!({
      "choices": [{ "message": { "content": [{ "type": "text", "text": "done" }] } }]
    });
    assert_eq!(extract_output_text(&chat_parts, WireApi::Chat).as_deref(), Some("done"));
    let anthropic_body = serde_json::json!({
      "content": [{ "type": "thinking", "thinking": "..." }, { "type": "text", "text": "done" }]
    });
    assert_eq!(extract_output_text(&anthropic_body, WireApi::Anthropic).as_deref(), Some("done"));
    let responses_body = serde_json::json!({ "output_text": "done" });
    assert_eq!(extract_output_text(&responses_body, WireApi::Responses).as_deref(), Some("done"));
    assert_eq!(extract_output_text(&chat_body, WireApi::Anthropic), None);
  }

  /// Answers one request with `body` and returns what the adapter sent.
  fn fake_endpoint(body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
    fake_endpoint_with_status("200 OK", body)
  }

  fn fake_endpoint_with_status(status: &'static str, body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
      let (mut stream, _) = listener.accept().unwrap();
      let mut buffer = [0u8; 4096];
      let read = stream.read(&mut buffer).unwrap();
      let response = format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
        body.len(),
      );
      stream.write_all(response.as_bytes()).unwrap();
      stream.flush().unwrap();
      String::from_utf8_lossy(&buffer[..read]).to_lowercase()
    });
    (port, handle)
  }

  #[tokio::test]
  async fn calls_a_chat_endpoint_with_a_bearer_credential() {
    let (port, endpoint) = fake_endpoint(r#"{"choices":[{"message":{"content":"pong"}}]}"#);
    let mut provider = provider(WireApi::Chat);
    provider.base_url = format!("http://127.0.0.1:{port}/v1");

    let result = invoke(provider, "ping").await.unwrap();
    assert_eq!(result.output, "pong");
    assert_eq!(result.model, "model-1");

    let request = endpoint.join().unwrap();
    assert!(request.starts_with("post /v1/chat/completions"), "{request}");
    assert!(request.contains("authorization: bearer sk-test"), "{request}");
  }

  #[tokio::test]
  async fn calls_an_anthropic_endpoint_with_its_own_headers() {
    let (port, endpoint) = fake_endpoint(r#"{"content":[{"type":"text","text":"pong"}]}"#);
    let mut provider = provider(WireApi::Anthropic);
    provider.base_url = format!("http://127.0.0.1:{port}/v1");

    let result = invoke(provider, "ping").await.unwrap();
    assert_eq!(result.output, "pong");

    let request = endpoint.join().unwrap();
    assert!(request.starts_with("post /v1/messages"), "{request}");
    assert!(request.contains("x-api-key: sk-test"), "{request}");
    assert!(request.contains("anthropic-version: 2023-06-01"), "{request}");
    // A credential must never travel in a header the vendor does not expect.
    assert!(!request.contains("authorization:"), "{request}");
  }

  #[tokio::test]
  async fn explains_a_refusal_in_the_words_of_the_vendor() {
    let (port, endpoint) = fake_endpoint_with_status(
      "503 Service Unavailable",
      r#"{"error":{"message":"not_found_error: model: Claude-Opus-5 with key sk-1234567890abcdef"}}"#,
    );
    let mut provider = provider(WireApi::Anthropic);
    provider.base_url = format!("http://127.0.0.1:{port}/v1");

    let error = invoke(provider, "ping").await.unwrap_err();
    assert!(error.starts_with("Provider 请求失败（HTTP 503） · "), "{error}");
    assert!(error.contains("not_found_error: model: Claude-Opus-5"), "{error}");
    // A key echoed back by the vendor must not reach the interface.
    assert!(!error.contains("sk-1234567890abcdef"), "{error}");
    endpoint.join().unwrap();
  }

  #[test]
  fn provider_timeout_allows_long_reasoning_requests() {
    assert!(REQUEST_TIMEOUT >= Duration::from_secs(600));
  }

  #[test]
  fn retries_only_connect_failures_up_to_the_limit() {
    let attempts = Cell::new(0);
    let result = tauri::async_runtime::block_on(retry_connect_failures(
      || {
        let attempt = attempts.get() + 1;
        attempts.set(attempt);
        async move {
          if attempt < CONNECT_ATTEMPTS {
            Err(TestError { retryable: true })
          } else {
            Ok("connected")
          }
        }
      },
      |error| error.retryable,
    ));

    assert_eq!(result, Ok("connected"));
    assert_eq!(attempts.get(), CONNECT_ATTEMPTS);

    let attempts = Cell::new(0);
    let result = tauri::async_runtime::block_on(retry_connect_failures(
      || {
        attempts.set(attempts.get() + 1);
        async { Err::<(), _>(TestError { retryable: false }) }
      },
      |error| error.retryable,
    ));

    assert_eq!(result, Err(TestError { retryable: false }));
    assert_eq!(attempts.get(), 1);
  }
}
