#!/usr/bin/env bash
set -euo pipefail

# Instantiate the stats-lib fixture into a target directory as a fresh git repo.
#
# Usage: setup-fixture.sh <target-dir>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:?usage: setup-fixture.sh <target-dir>}"

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "ERROR: target $TARGET exists and is not empty" >&2
  exit 1
fi

mkdir -p "$TARGET"
cp -R "$SCRIPT_DIR/fixtures/stats-lib/." "$TARGET/"

cd "$TARGET"
printf '.coord/\nnode_modules/\n' > .gitignore
git init -q
git add -A
git -c user.name="harness" -c user.email="harness@localhost" commit -qm "chore: initial fixture state"

echo "Fixture ready at: $TARGET"
echo "Baseline test run:"
npm test --silent
