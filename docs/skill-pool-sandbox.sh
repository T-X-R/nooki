#!/bin/bash
# Rehearse the Skill Pool against a throwaway HOME. Your real ~/.agents, ~/.codex,
# ~/.claude and Nooki data are never read or written.
#
#   ./docs/skill-pool-sandbox.sh reset    build a fresh sandbox (no ~/.agents/skills)
#   ./docs/skill-pool-sandbox.sh open     launch Nooki inside the sandbox
#   ./docs/skill-pool-sandbox.sh add      drop a new skill into the sandbox pool, as an agent would
#   ./docs/skill-pool-sandbox.sh status   show what the sandbox holds
#   ./docs/skill-pool-sandbox.sh clean    delete the sandbox
set -euo pipefail

SANDBOX="${NOOKI_SANDBOX:-/tmp/nooki-sandbox-home}"
APP="${NOOKI_APP:-/Applications/Nooki.app/Contents/MacOS/app}"

skill() { # skill <directory> <name> <description>
  mkdir -p "$1/$2"
  printf -- '---\nname: %s\ndescription: %s\n---\n\n# %s\n\nA sandbox skill.\n' "$2" "$3" "$2" > "$1/$2/SKILL.md"
}

case "${1:-status}" in
  reset)
    rm -rf "$SANDBOX"
    # A machine that has coding tools but has never had a skill pool.
    mkdir -p "$SANDBOX/.codex/skills/.system" "$SANDBOX/.claude/skills" "$SANDBOX/.pi" "$SANDBOX/Library"
    echo '{"tool":"internals"}' > "$SANDBOX/.codex/skills/endpoint-registry.json"
    skill "$SANDBOX/.claude/skills" sandbox-handwritten "A skill that only exists inside Claude Code"
    skill "$SANDBOX/.codex/skills" sandbox-shared "A skill Codex holds under a name Claude Code also uses"
    skill "$SANDBOX/.claude/skills" sandbox-shared "The same name with different content, to force a choice"
    mkdir -p "$SANDBOX/Library/xxa/skills"
    echo "sandbox ready at $SANDBOX (no ~/.agents/skills yet)"
    ;;
  open)
    [ -d "$SANDBOX" ] || { echo "run 'reset' first"; exit 1; }
    echo "launching Nooki with HOME=$SANDBOX"
    HOME="$SANDBOX" "$APP" &
    ;;
  add)
    name="${2:-sandbox-from-github}"
    skill "$SANDBOX/.agents/skills" "$name" "Installed into the pool by an agent"
    echo "added $name to $SANDBOX/.agents/skills — switch to the Nooki window to see it sync"
    ;;
  status)
    echo "sandbox: $SANDBOX"
    for directory in .agents/skills .codex/skills .claude/skills Library/xxa/skills .agents/.nooki-trash; do
      printf '\n%s\n' "$directory"
      ls -l "$SANDBOX/$directory" 2>/dev/null | tail -n +2 | awk '{print "  " $1 " " $9 ($11 ? " -> " $11 : "")}' || echo "  (missing)"
    done
    ;;
  clean) rm -rf "$SANDBOX"; echo "removed $SANDBOX" ;;
  *) echo "usage: $0 {reset|open|add [name]|status|clean}"; exit 1 ;;
esac
