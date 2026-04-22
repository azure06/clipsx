#!/usr/bin/env zsh
# clean-ai-history.sh
# Removes history/logs from Claude, Codex, and VS Code Copilot
# Preserves: plugins, skills, auth/config, memories, rules

set -euo pipefail

DRY_RUN=false
VERBOSE=false

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --verbose) VERBOSE=true ;;
    --help)
      echo "Usage: $0 [--dry-run] [--verbose]"
      echo "  --dry-run   Show what would be deleted without deleting"
      echo "  --verbose   Print each item as it's removed"
      exit 0
      ;;
  esac
done

# ─── helpers ──────────────────────────────────────────────────────────────────

remove() {
  local target="$1"
  if [[ ! -e "$target" ]]; then return; fi
  if $VERBOSE || $DRY_RUN; then echo "  rm: $target"; fi
  if ! $DRY_RUN; then rm -rf -- "$target"; fi
}

remove_glob() {
  local pattern="$1"
  # Use nullglob so missing patterns don't error
  setopt local_options nullglob
  for f in ${~pattern}; do
    remove "$f"
  done
}

section() { echo "\n── $1 ──────────────────────────────────────"; }

# ─── ~/.claude ────────────────────────────────────────────────────────────────
# Preserve: plugins/, skills/, settings.json
# Delete:   history.jsonl, sessions/*, file-history/*, cache/*, session-env/*,
#           shell-snapshots/*, backups/*, plans/*, projects/*

section "~/.claude"

CLAUDE="$HOME/.claude"
if [[ -d "$CLAUDE" ]]; then
  remove "$CLAUDE/history.jsonl"
  remove_glob "$CLAUDE/sessions/*"
  remove_glob "$CLAUDE/file-history/*"
  remove_glob "$CLAUDE/cache/*"
  remove_glob "$CLAUDE/session-env/*"
  remove_glob "$CLAUDE/shell-snapshots/*"
  remove_glob "$CLAUDE/backups/*"
  remove_glob "$CLAUDE/plans/*"
  remove_glob "$CLAUDE/projects/*"
  echo "  preserved: plugins/ skills/ settings.json ide/"
else
  echo "  ~/.claude not found, skipping"
fi

# ─── ~/.codex ─────────────────────────────────────────────────────────────────
# Preserve: config.toml (auth), installation_id, version.json, memories/,
#           rules/, skills/, vendor_imports/, AGENTS.md, .personality_migration
# Delete:   history.jsonl, sessions/*, logs_2.sqlite*, session_index.jsonl,
#           shell_snapshots/*, .tmp/*, state_5.sqlite*

section "~/.codex"

CODEX="$HOME/.codex"
if [[ -d "$CODEX" ]]; then
  remove "$CODEX/history.jsonl"
  remove "$CODEX/session_index.jsonl"
  remove_glob "$CODEX/sessions/*"
  remove_glob "$CODEX/shell_snapshots/*"
  remove_glob "$CODEX/.tmp/*"
  # SQLite databases (logs + state)
  remove "$CODEX/logs_2.sqlite"
  remove "$CODEX/logs_2.sqlite-shm"
  remove "$CODEX/logs_2.sqlite-wal"
  remove "$CODEX/state_5.sqlite"
  remove "$CODEX/state_5.sqlite-shm"
  remove "$CODEX/state_5.sqlite-wal"
  echo "  preserved: config.toml installation_id version.json memories/ rules/ skills/ vendor_imports/"
else
  echo "  ~/.codex not found, skipping"
fi

# ─── VS Code – GitHub Copilot chat history ────────────────────────────────────
# Global storage: ~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/
#   Delete:   logContextRecordings/state.json, copilot.cli.oldGlobalSessions.json,
#             copilotCli/ contents, copilot-cli-images/
#   Preserve: api.json, *Embeddings.json, *.bin, ask-agent/, explore-agent/,
#             plan-agent/, debugCommand/
# Additional global history: ~/Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions/
#   Delete:   all files (chat sessions from empty/no-folder windows)
# Per-workspace storage: ~/Library/Application Support/Code/User/workspaceStorage/*/
#   Delete:   chatSessions/*, chatEditingSessions/*,
#             GitHub.copilot-chat/transcripts/*, GitHub.copilot-chat/debug-logs/*

section "VS Code Copilot – global storage"

COPILOT_GLOBAL="$HOME/Library/Application Support/Code/User/globalStorage/github.copilot-chat"
if [[ -d "$COPILOT_GLOBAL" ]]; then
  remove "$COPILOT_GLOBAL/logContextRecordings/state.json"
  remove "$COPILOT_GLOBAL/copilot.cli.oldGlobalSessions.json"
  remove_glob "$COPILOT_GLOBAL/copilotCli/*"
  remove_glob "$COPILOT_GLOBAL/copilot-cli-images/*"
  echo "  preserved: api.json *Embeddings.json *.bin ask-agent/ explore-agent/ plan-agent/ debugCommand/"
else
  echo "  Copilot global storage not found, skipping"
fi

# Empty-window chat sessions are stored outside github.copilot-chat
EMPTY_WINDOW_CHAT="$HOME/Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions"
if [[ -d "$EMPTY_WINDOW_CHAT" ]]; then
  remove_glob "$EMPTY_WINDOW_CHAT/*"
fi

section "VS Code Copilot – workspace storage (all workspaces)"

WS_ROOT="$HOME/Library/Application Support/Code/User/workspaceStorage"
if [[ -d "$WS_ROOT" ]]; then
  setopt local_options nullglob
  for ws in "$WS_ROOT"/*/; do
    # chatSessions
    remove_glob "${ws}chatSessions/*"
    # chatEditingSessions
    remove_glob "${ws}chatEditingSessions/*"
    # Copilot transcripts and debug logs
    remove_glob "${ws}GitHub.copilot-chat/transcripts/*"
    remove_glob "${ws}GitHub.copilot-chat/debug-logs/*"
  done
  echo "  preserved: workspace.json state.vscdb* ms-python.* GitHub.copilot-chat/(non-log dirs)"
else
  echo "  VS Code workspaceStorage not found, skipping"
fi

# ─── done ─────────────────────────────────────────────────────────────────────

echo ""
if $DRY_RUN; then
  echo "Dry run complete – nothing was deleted."
else
  echo "Done. History/logs cleared."
fi
