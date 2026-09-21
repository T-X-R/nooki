use app_lib::{conversation_skills, skill_pool::SkillPool};
use std::{fs, path::PathBuf};

fn sandbox(label: &str) -> (PathBuf, SkillPool) {
    let home = std::env::temp_dir().join(format!(
        "nooki-conversation-skills-{label}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&home);
    fs::create_dir_all(home.join(".agents/skills/pdf-tools")).unwrap();
    fs::write(
        home.join(".agents/skills/pdf-tools/SKILL.md"),
        "---\nname: pdf\ndescription: Works with PDFs.\n---\n\n# PDF\n",
    )
    .unwrap();
    fs::create_dir_all(home.join(".agents/skills/unnamed")).unwrap();
    fs::write(home.join(".agents/skills/unnamed/SKILL.md"), "no frontmatter\n").unwrap();
    fs::create_dir_all(home.join(".agents/skills/not-a-skill")).unwrap();
    let data = home.join("data");
    let pool = SkillPool::new(home.clone(), data);
    (home, pool)
}

#[test]
fn an_attached_skill_resolves_to_its_pool_directory_and_declared_name() {
    let (home, pool) = sandbox("resolve");
    let skills = conversation_skills::resolve(
        &pool,
        &["pdf-tools".to_string(), "pdf-tools".to_string(), "unnamed".to_string()],
    )
    .unwrap();
    // The person's order survives, a repeat does not, and Nooki never reads past the frontmatter.
    assert_eq!(skills.len(), 2);
    assert_eq!(skills[0].directory, "pdf-tools");
    assert_eq!(skills[0].invocation, "pdf");
    assert_eq!(skills[0].path, home.join(".agents/skills/pdf-tools"));
    // A skill that declares no name is still addressable by the directory the pool knows it as.
    assert_eq!(skills[1].invocation, "unnamed");
    let _ = fs::remove_dir_all(home);
}

#[test]
fn a_skill_the_pool_cannot_serve_stops_the_turn_before_an_agent_is_started() {
    let (home, pool) = sandbox("refuse");
    for name in ["missing", "not-a-skill", "../escape", ".hidden"] {
        assert!(conversation_skills::resolve(&pool, &[name.to_string()]).is_err());
    }
    let _ = fs::remove_dir_all(home);
}

#[test]
fn each_cli_is_addressed_in_its_own_words() {
    let (home, pool) = sandbox("prefix");
    let skills = conversation_skills::resolve(&pool, &["pdf-tools".into(), "unnamed".into()]).unwrap();
    // pi and Claude Code expand a leading command; only the first attached skill can lead.
    assert_eq!(conversation_skills::command_prefix("pi", &skills), "/skill:pdf ");
    assert_eq!(conversation_skills::command_prefix("claude", &skills), "/pdf ");
    // Codex carries skills structurally, so nothing is put in front of the person's words.
    assert_eq!(conversation_skills::command_prefix("codex", &skills), "");
    assert_eq!(conversation_skills::command_prefix("pi", &[]), "");
    let _ = fs::remove_dir_all(home);
}
