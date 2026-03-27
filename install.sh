#!/usr/bin/env bash
set -euo pipefail

# Claude Coordinator installer
# Copies agent files to ~/.claude/agents/ and optionally initializes project state.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$HOME/.claude/agents"
INIT_PROJECT=false

# ─── Help ────────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Install Claude Coordinator agents to ~/.claude/agents/.

Options:
  --init-project    Also initialize docs/ and .coord/ template directories
                    in the current working directory
  --help            Show this help message and exit

Examples:
  # Install agents globally (most common):
  ./install.sh

  # Install agents AND initialize project state in current directory:
  ./install.sh --init-project

EOF
}

# ─── Argument parsing ────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --init-project)
      INIT_PROJECT=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      usage
      exit 1
      ;;
  esac
done

# ─── Install agents ──────────────────────────────────────────────────────────

echo "Installing Claude Coordinator agents..."

# Create agents directory if it doesn't exist
if [ ! -d "$AGENTS_DIR" ]; then
  echo "  Creating $AGENTS_DIR"
  mkdir -p "$AGENTS_DIR"
fi

# Copy agent files (idempotent — overwrites existing)
for agent in coordinator worker reviewer; do
  src="$SCRIPT_DIR/agents/${agent}.md"
  dst="$AGENTS_DIR/${agent}.md"
  if [ ! -f "$src" ]; then
    echo "  ERROR: Missing agent file: $src"
    exit 1
  fi
  cp "$src" "$dst"
  echo "  Installed: $dst"
done

echo ""
echo "Agents installed successfully."

# ─── Initialize project (optional) ──────────────────────────────────────────

if [ "$INIT_PROJECT" = true ]; then
  echo ""
  echo "Initializing project templates in: $(pwd)"

  TEMPLATES_DIR="$SCRIPT_DIR/templates"

  # docs/context/
  mkdir -p docs/context docs/plans .coord

  for f in current-intent.md repo-practices.md known-issues.md; do
    dst="docs/context/$f"
    if [ -f "$dst" ]; then
      echo "  Skipping (exists): $dst"
    else
      cp "$TEMPLATES_DIR/docs/context/$f" "$dst"
      echo "  Created: $dst"
    fi
  done

  # docs/plans/
  for f in active-plan.md execution-brief.md; do
    dst="docs/plans/$f"
    if [ -f "$dst" ]; then
      echo "  Skipping (exists): $dst"
    else
      cp "$TEMPLATES_DIR/docs/plans/$f" "$dst"
      echo "  Created: $dst"
    fi
  done

  # .coord/
  for f in task-ledger.json learning-inbox.jsonl context-packet.md; do
    dst=".coord/$f"
    if [ -f "$dst" ]; then
      echo "  Skipping (exists): $dst"
    else
      cp "$TEMPLATES_DIR/.coord/$f" "$dst"
      echo "  Created: $dst"
    fi
  done

  echo ""
  echo "Project initialized."
fi

# ─── Usage instructions ──────────────────────────────────────────────────────

cat <<EOF

How to use Claude Coordinator:

  Start a session:
    claude --agent coordinator

  Or select "coordinator" from the agent picker in Claude Code.

  The coordinator will:
    1. Read context from docs/ and .coord/ (if present)
    2. Ask what you want to work on
    3. Plan, delegate, review, and summarize — all automatically

  To initialize project state directories:
    ./install.sh --init-project

EOF
