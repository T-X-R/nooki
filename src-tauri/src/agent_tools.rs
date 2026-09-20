//! The coding agents installed on this machine.
//!
//! Nooki lists agents, never ways of signing into one. Whether Codex holds a subscription or an API
//! key is recorded in its own `auth.json`; asking a person to declare it would ask them to maintain
//! a second copy of a fact the tool already owns. An agent that cannot report its state says so
//! rather than being guessed at.
//!
//! Detection reads files and never runs an agent binary: opening Settings should not start four
//! processes, and a state a file already records needs no subprocess to confirm. Running an agent is
//! reserved for the moment a Capability actually asks for work — which is also the only model access
//! Nooki has, since it no longer speaks to a model service itself.
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Long enough for a Capability's summarisation, short enough that a wedged agent is not forever.
const INVOCATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

pub struct AgentTools {
  pub home: PathBuf,
  pub codex_home: PathBuf,
  pub claude_home: PathBuf,
  pub pi_home: PathBuf,
  binaries: Vec<PathBuf>,
  apps: Vec<PathBuf>,
}

/// One agent Nooki knows how to detect, and where it reads skills from.
pub struct Builtin {
  pub id: &'static str,
  pub name: &'static str,
  pub skills: PathBuf,
  pub detected: bool,
  /// True when the tool reads the Skill Pool itself, so mirroring into it would duplicate the pool.
  pub reads_pool: bool,
}

/// `in`, `out`, or `unknown`. Never a value a person typed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
  pub state: String,
  /// How the tool says it is signed in, in the tool's own terms. Absent when it does not say.
  pub method: Option<String>,
  /// What a person would run, in that tool, to sign in. Nooki never collects the credential.
  pub hint: Option<String>,
}

impl SignIn {
  fn unknown() -> Self { Self { state: "unknown".into(), method: None, hint: None } }
  fn out(hint: &str) -> Self { Self { state: "out".into(), method: None, hint: Some(hint.into()) } }
  fn signed(method: &str) -> Self { Self { state: "in".into(), method: Some(method.into()), hint: None } }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolView {
  pub id: String,
  pub name: String,
  pub directory: String,
  pub detected: bool,
  pub reads_pool: bool,
  pub custom: bool,
  pub sign_in: SignIn,
  /// Whether this agent can run a one-shot turn for a Capability.
  pub serves_capabilities: bool,
}

/// What a Capability receives back. The shape predates the substrate decision and is kept so no
/// Capability changes; only what produces it changed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelResult {
  pub provider: String,
  pub model: String,
  pub output: String,
}

/// Why a one-shot turn did not produce an answer. Kept structured rather than as a string, because
/// the same reason has to be readable in two languages and nobody should translate by pattern match
/// on prose.
#[derive(Clone, Debug, PartialEq)]
pub enum InvocationError {
  /// The agent is not installed, is signed out, or has no one-shot Nooki knows.
  Unavailable(String),
  CouldNotStart(String),
  Timeout(String),
  Failed(String),
  NoText(String),
}

impl InvocationError {
  pub fn say(&self, english: bool) -> String {
    match self {
      Self::Unavailable(name) if english => format!("{name} cannot run Capability requests right now. Install it and sign in."),
      Self::Unavailable(name) => format!("{name} 现在无法承接能力包请求，请先安装并登录。"),
      Self::CouldNotStart(name) if english => format!("Could not start {name}."),
      Self::CouldNotStart(name) => format!("无法启动 {name}。"),
      Self::Timeout(name) if english => format!("{name} did not answer in time."),
      Self::Timeout(name) => format!("{name} 未在规定时间内给出回答。"),
      Self::Failed(name) if english => format!("{name} returned an error. Check that it is signed in."),
      Self::Failed(name) => format!("{name} 返回了错误，请确认它已登录。"),
      Self::NoText(name) if english => format!("{name} returned no text."),
      Self::NoText(name) => format!("{name} 没有返回文本结果。"),
    }
  }
}

/// How to ask one agent for a single answer without a session, tools, or write access.
struct OneShot {
  binary: &'static str,
  before: &'static [&'static str],
  after: &'static [&'static str],
}

fn one_shot(id: &str) -> Option<OneShot> {
  match id {
    "codex" => Some(OneShot {
      binary: "codex",
      before: &["exec", "--ephemeral", "--json", "--sandbox", "read-only", "--skip-git-repo-check"],
      after: &[],
    }),
    "claude" => Some(OneShot { binary: "claude", before: &["-p"], after: &["--output-format", "json"] }),
    "pi" => Some(OneShot { binary: "pi", before: &["--print", "--mode", "json"], after: &[] }),
    _ => None,
  }
}

impl AgentTools {
  pub fn new(home: PathBuf) -> Self {
    Self {
      codex_home: home.join(".codex"),
      claude_home: home.join(".claude"),
      pi_home: home.join(".pi"),
      binaries: vec![home.join(".local/bin"), home.join(".npm-global/bin"), home.join(".hermes/node/bin")],
      apps: Vec::new(),
      home,
    }
  }

  pub fn from_environment() -> Result<Self, String> {
    let home = std::env::var_os("HOME")
      .or_else(|| std::env::var_os("USERPROFILE"))
      .map(PathBuf::from)
      .filter(|path| path.is_absolute())
      .ok_or("Cannot locate the current user's home directory")?;
    let mut tools = Self::new(home);
    if let Some(path) = std::env::var_os("CODEX_HOME").map(PathBuf::from).filter(|p| p.is_absolute()) { tools.codex_home = path; }
    if let Some(path) = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).filter(|p| p.is_absolute()) { tools.claude_home = path; }
    if let Some(path) = std::env::var_os("PATH") { tools.binaries.extend(std::env::split_paths(&path)); }
    tools.binaries.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
    tools.apps = vec![PathBuf::from("/Applications/Codex.app"), tools.home.join("Applications/Codex.app")];
    Ok(tools)
  }

  pub fn binary(&self, name: &str) -> bool {
    self.binary_path(name).is_some()
  }

  fn binary_path(&self, name: &str) -> Option<PathBuf> {
    self.binaries.iter().find_map(|dir| {
      [name.to_string(), format!("{name}.cmd"), format!("{name}.exe")]
        .into_iter()
        .map(|file| dir.join(file))
        .find(|path| path.is_file())
    })
  }

  /// The agents Nooki ships detection for, in the order a person sees them.
  pub fn builtin(&self, pool: &Path) -> Vec<Builtin> {
    vec![
      Builtin {
        id: "codex",
        name: "Codex",
        skills: self.codex_home.join("skills"),
        detected: self.codex_home.is_dir() || self.binary("codex") || self.apps.iter().any(|path| path.is_dir()),
        reads_pool: false,
      },
      Builtin {
        id: "claude",
        name: "Claude Code",
        skills: self.claude_home.join("skills"),
        detected: self.claude_home.is_dir() || self.binary("claude"),
        reads_pool: false,
      },
      Builtin {
        id: "pi",
        name: "pi",
        skills: pool.to_path_buf(),
        detected: self.pi_home.is_dir() || self.binary("pi"),
        reads_pool: true,
      },
    ]
  }

  /// Read from the tool's own files. Never from a subprocess, and never from the person.
  pub fn sign_in(&self, id: &str) -> SignIn {
    match id {
      "codex" => {
        let path = self.codex_home.join("auth.json");
        let Ok(bytes) = std::fs::read(&path) else { return SignIn::out("codex login") };
        let Ok(auth) = serde_json::from_slice::<Value>(&bytes) else { return SignIn::unknown() };
        match auth["auth_mode"].as_str() {
          Some("chatgpt") => SignIn::signed("ChatGPT"),
          Some("apikey") => SignIn::signed("API key"),
          Some(other) if !other.is_empty() => SignIn::signed(other),
          // A key with no declared mode is still a usable sign-in.
          _ if auth["OPENAI_API_KEY"].as_str().is_some_and(|key| !key.is_empty()) => SignIn::signed("API key"),
          _ if auth.get("tokens").is_some_and(|tokens| !tokens.is_null()) => SignIn::unknown(),
          _ => SignIn::out("codex login"),
        }
      }
      // Claude Code and pi keep credentials outside any file Nooki may read, so Nooki does not
      // claim to know. Sign-in is managed in the tool either way.
      "claude" | "pi" => SignIn::unknown(),
      _ => SignIn::unknown(),
    }
  }

  /// An agent may serve a Capability when it is here and Nooki knows how to ask it for one answer.
  ///
  /// Sign-in is not a condition. pi has no login — an API key in its own config is enough — and an
  /// agent that does have one can report its own refusal far better than Nooki can predict it.
  /// Gating on a state Nooki reads from the outside would block working setups to prevent an error
  /// message that is already clear.
  pub fn serves_capabilities(&self, id: &str, detected: bool) -> bool {
    detected && one_shot(id).is_some()
  }

  pub fn overview(&self, pool: &Path, custom: &[(String, String, String)]) -> Vec<AgentToolView> {
    let mut views: Vec<AgentToolView> = self
      .builtin(pool)
      .into_iter()
      .map(|tool| {
        let sign_in = self.sign_in(tool.id);
        AgentToolView {
          serves_capabilities: self.serves_capabilities(tool.id, tool.detected),
          id: tool.id.into(),
          name: tool.name.into(),
          directory: tool.skills.to_string_lossy().into_owned(),
          detected: tool.detected,
          reads_pool: tool.reads_pool,
          custom: false,
          sign_in,
        }
      })
      .collect();
    for (id, name, directory) in custom {
      let path = PathBuf::from(directory);
      views.push(AgentToolView {
        id: id.clone(),
        name: name.clone(),
        detected: path.is_dir(),
        reads_pool: path == pool,
        directory: directory.clone(),
        custom: true,
        sign_in: SignIn::unknown(),
        // A tool Nooki learned about from a directory has no invocation Nooki knows.
        serves_capabilities: false,
      });
    }
    views
  }

  /// The first agent that could serve a Capability, used when the selection names one that has since
  /// been removed or signed out.
  pub fn default_agent(&self, pool: &Path) -> Option<String> {
    self.overview(pool, &[]).into_iter().find(|tool| tool.serves_capabilities).map(|tool| tool.id)
  }

  pub(crate) fn command(&self, binary: &str) -> std::io::Result<tokio::process::Command> {
    let resolved = self.binary_path(binary).map(|path| path.to_string_lossy().into_owned()).unwrap_or_else(|| binary.to_string());
    with_launcher_path(&resolved).map(tokio::process::Command::from)
  }

  pub fn name_of(&self, id: &str) -> String {
    self.builtin(Path::new("")).into_iter().find(|tool| tool.id == id).map(|tool| tool.name.to_string()).unwrap_or_else(|| id.to_string())
  }

  /// One turn, no session, read-only, no tools beyond whatever the agent does by default.
  pub async fn invoke(&self, id: &str, pool: &Path, prompt: &str) -> Result<ModelResult, InvocationError> {
    let name = self.name_of(id);
    let available = self
      .builtin(pool)
      .into_iter()
      .find(|tool| tool.id == id)
      .is_some_and(|tool| self.serves_capabilities(id, tool.detected));
    let recipe = match one_shot(id) {
      Some(recipe) if available => recipe,
      _ => return Err(InvocationError::Unavailable(name)),
    };

    let mut command = self.command(recipe.binary).map_err(|_| InvocationError::CouldNotStart(name.clone()))?;
    command.kill_on_drop(true);
    command.args(recipe.before).arg(prompt).args(recipe.after);
    let output = tokio::time::timeout(INVOCATION_TIMEOUT, command.output())
      .await
      .map_err(|_| InvocationError::Timeout(name.clone()))?
      .map_err(|_| InvocationError::CouldNotStart(name.clone()))?;

    if !output.status.success() {
      return Err(InvocationError::Failed(name));
    }
    let stdout = String::from_utf8(output.stdout).map_err(|_| InvocationError::NoText(name.clone()))?;
    let (text, model) = read_answer(id, &stdout).ok_or(InvocationError::NoText(name.clone()))?;
    Ok(ModelResult { provider: name, model, output: text })
  }
}

/// An agent installed through a Node launcher needs its own directory on PATH to find that runtime.
/// A Finder-launched app inherits a PATH that usually does not have it.
pub fn with_launcher_path(binary: &str) -> std::io::Result<std::process::Command> {
  let mut command = std::process::Command::new(binary);
  if let Some(parent) = Path::new(binary).parent().filter(|path| !path.as_os_str().is_empty()) {
    let inherited = std::env::var_os("PATH").unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin".into());
    let paths = std::iter::once(parent.to_path_buf()).chain(std::env::split_paths(&inherited));
    command.env("PATH", std::env::join_paths(paths).map_err(std::io::Error::other)?);
  }
  Ok(command)
}

/// Each agent prints its own shape. Where a shape is not recognised the raw output is preferred over
/// an error, because a person would rather read an unexpected answer than lose one.
fn read_answer(id: &str, stdout: &str) -> Option<(String, String)> {
  match id {
    "codex" => {
      let mut model = String::new();
      let mut answer = None;
      for line in stdout.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
        if let Some(named) = event["model"].as_str().or_else(|| event["thread"]["model"].as_str()) {
          if !named.is_empty() { model = named.to_string(); }
        }
        let item = &event["item"];
        if event["type"] == "item.completed" && item["type"] == "agent_message" {
          if let Some(text) = item["text"].as_str() { answer = Some(text.to_string()); }
        }
      }
      answer.map(|text| (text, model))
    }
    _ => {
      let trimmed = stdout.trim();
      if trimmed.is_empty() { return None; }
      let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return Some((trimmed.to_string(), String::new()));
      };
      let model = value["model"].as_str().unwrap_or_default().to_string();
      let text = ["result", "text", "output", "message", "content"]
        .into_iter()
        .find_map(|key| value[key].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| trimmed.to_string());
      Some((text, model))
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sandbox(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("nooki-agents-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).unwrap();
    path
  }

  #[test]
  fn a_machine_without_agents_offers_none() {
    let home = sandbox("empty");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home.clone()) };
    let pool = home.join(".agents/skills");
    assert!(tools.overview(&pool, &[]).iter().all(|tool| !tool.detected));
    assert_eq!(tools.default_agent(&pool), None);
  }

  #[test]
  fn codex_reports_how_it_is_signed_in() {
    let home = sandbox("codex-auth");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home.clone()) };
    std::fs::create_dir_all(&tools.codex_home).unwrap();

    std::fs::write(tools.codex_home.join("auth.json"), br#"{"auth_mode":"chatgpt","tokens":{"a":1}}"#).unwrap();
    let signed = tools.sign_in("codex");
    assert_eq!(signed.state, "in");
    assert_eq!(signed.method.as_deref(), Some("ChatGPT"));

    std::fs::write(tools.codex_home.join("auth.json"), br#"{"auth_mode":"apikey"}"#).unwrap();
    assert_eq!(tools.sign_in("codex").method.as_deref(), Some("API key"));
  }

  #[test]
  fn a_missing_auth_file_sends_the_person_to_the_tool() {
    let home = sandbox("codex-signed-out");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home) };
    let state = tools.sign_in("codex");
    assert_eq!(state.state, "out");
    assert_eq!(state.hint.as_deref(), Some("codex login"));
    assert_eq!(state.method, None);
  }

  #[test]
  fn an_agent_that_does_not_report_is_not_guessed_at() {
    let home = sandbox("claude-unknown");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home) };
    assert_eq!(tools.sign_in("claude").state, "unknown");
  }

  #[test]
  fn being_installed_is_the_only_condition_for_serving() {
    let home = sandbox("serving");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home) };
    // pi has no login to detect, and a signed-out Codex may be signed in a moment later.
    assert!(tools.serves_capabilities("pi", true));
    assert!(tools.serves_capabilities("codex", true));
    assert!(!tools.serves_capabilities("codex", false));
    // A tool Nooki has no way to run is refused whatever its state.
    assert!(!tools.serves_capabilities("zyx", true));
  }

  #[test]
  fn a_custom_tool_is_listed_but_cannot_be_invoked() {
    let home = sandbox("custom");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home.clone()) };
    let directory = home.join("somewhere");
    std::fs::create_dir_all(&directory).unwrap();
    let custom = vec![("zyx".to_string(), "zyx".to_string(), directory.to_string_lossy().into_owned())];
    let listed = tools.overview(&home.join(".agents/skills"), &custom);
    let entry = listed.iter().find(|tool| tool.id == "zyx").unwrap();
    assert!(entry.detected);
    assert!(!entry.serves_capabilities);
    assert_eq!(entry.sign_in.state, "unknown");
  }

  #[test]
  fn codex_output_is_read_from_its_last_message() {
    let stdout = "{\"type\":\"turn.started\",\"model\":\"gpt-5\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"first\"}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"second\"}}\n";
    assert_eq!(read_answer("codex", stdout), Some(("second".into(), "gpt-5".into())));
    assert_eq!(read_answer("codex", "{\"type\":\"turn.started\"}"), None);
  }

  #[test]
  fn another_agent_is_read_from_its_json_or_kept_verbatim() {
    assert_eq!(
      read_answer("claude", "{\"result\":\"done\",\"model\":\"claude-x\"}"),
      Some(("done".into(), "claude-x".into())),
    );
    assert_eq!(read_answer("pi", "  plain words  "), Some(("plain words".into(), String::new())));
    assert_eq!(read_answer("pi", "   "), None);
  }

  #[tokio::test]
  async fn an_unavailable_agent_is_refused_before_a_process_starts() {
    let home = sandbox("unavailable");
    let tools = AgentTools { apps: Vec::new(), binaries: Vec::new(), ..AgentTools::new(home.clone()) };
    let pool = home.join(".agents/skills");
    assert_eq!(tools.invoke("codex", &pool, "hi").await, Err(InvocationError::Unavailable("Codex".into())));
    assert_eq!(tools.invoke("zyx", &pool, "hi").await, Err(InvocationError::Unavailable("zyx".into())));
  }

  #[cfg(unix)]
  #[tokio::test]
  async fn an_agent_installed_behind_a_launcher_still_runs() {
    use std::os::unix::fs::PermissionsExt;
    let home = sandbox("launcher");
    // The launcher can only be found through the PATH entry Nooki prepends for the agent itself.
    let runtime = home.join("nooki-test-node");
    std::fs::write(home.join("codex"), "#!/usr/bin/env nooki-test-node\n").unwrap();
    std::fs::write(&runtime, "#!/bin/sh\ncase \"$2 $3\" in\n  'exec --ephemeral') echo '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Ready\"}}' ;;\n  *) exit 2 ;;\nesac\n").unwrap();
    for file in ["codex", "nooki-test-node"] {
      std::fs::set_permissions(home.join(file), std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let tools = AgentTools { apps: Vec::new(), binaries: vec![home.clone()], ..AgentTools::new(home.clone()) };
    std::fs::create_dir_all(&tools.codex_home).unwrap();
    std::fs::write(tools.codex_home.join("auth.json"), br#"{"auth_mode":"chatgpt"}"#).unwrap();

    let result = tools.invoke("codex", &home.join(".agents/skills"), "Reply with Ready").await.unwrap();
    assert_eq!(result.output, "Ready");
    assert_eq!(result.provider, "Codex");
  }
}
