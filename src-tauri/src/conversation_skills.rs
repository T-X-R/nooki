//! Skills a person picked with `$` in the composer, said in each agent's own words.
//!
//! Nooki does not read, copy or quote a skill here. Every agent it hosts already loads skills from
//! a directory the Skill Pool serves, and every one of them has a way of being told to use one:
//! Codex takes a `skill` input element, pi expands `/skill:name`, Claude Code expands `/name`. This
//! module only resolves the pool entry and hands each transport that agent's native form, so the
//! skill behaves exactly as it does in that CLI.

use crate::skill_pool::SkillPool;
use std::path::PathBuf;

/// One skill the person attached to a message.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SkillReference {
    /// The pool directory name, which is how Nooki identifies a skill.
    pub directory: String,
    /// The name the skill declares for itself, which is how a CLI's own command names it.
    pub invocation: String,
    pub path: PathBuf,
}

/// Look up each attached skill in the pool, keeping the person's order and dropping repeats.
pub fn resolve(pool: &SkillPool, names: &[String]) -> Result<Vec<SkillReference>, String> {
    let mut resolved: Vec<SkillReference> = Vec::new();
    for name in names {
        if resolved.iter().any(|skill| skill.directory == *name) {
            continue;
        }
        resolved.push(pool.locate(name)?);
    }
    Ok(resolved)
}

/// What a transport with no structured channel has to put at the head of the message.
///
/// pi and Claude Code both expand a leading skill command and treat the rest of the message as its
/// arguments, so only the first attached skill can lead. The others stay in the message as the
/// person typed them, which is what their own composers would have done.
pub fn command_prefix(agent: &str, skills: &[SkillReference]) -> String {
    let Some(first) = skills.first() else {
        return String::new();
    };
    match agent {
        "pi" => format!("/skill:{} ", first.invocation),
        "claude" => format!("/{} ", first.invocation),
        _ => String::new(),
    }
}
