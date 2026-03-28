#!/usr/bin/env bash
set -euo pipefail

# Claude Coordinator State Validator
# Validates .coord/ and docs/ JSON files against their schemas.
#
# Usage:
#   validate-state.sh [file]           # Validate a specific file
#   validate-state.sh --all            # Validate all state files
#   validate-state.sh --schema <name>  # Validate stdin against a named schema
#
# Requires: python3 with jsonschema package
#   pip install jsonschema

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_DIR="$(cd "$SCRIPT_DIR/../schemas" && pwd)"
ERRORS=0

# ─── Helpers ────────────────────────────────────────────────────────────────

validate_json_syntax() {
  local file="$1"
  if ! python3 -c "import json; json.load(open('$file'))" 2>/dev/null; then
    echo "  ❌ SYNTAX ERROR: $file is not valid JSON"
    ERRORS=$((ERRORS + 1))
    return 1
  fi
  return 0
}

validate_jsonl_syntax() {
  local file="$1"
  local line_num=0
  local line_errors=0
  while IFS= read -r line; do
    line_num=$((line_num + 1))
    if [ -z "$line" ]; then continue; fi
    if ! echo "$line" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
      echo "  ❌ SYNTAX ERROR: $file line $line_num is not valid JSON"
      line_errors=$((line_errors + 1))
    fi
  done < "$file"
  ERRORS=$((ERRORS + line_errors))
  return $line_errors
}

validate_against_schema() {
  local file="$1"
  local schema="$2"

  if [ ! -f "$schema" ]; then
    echo "  ⚠️  SKIP: No schema found at $schema"
    return 0
  fi

  local result
  result=$(python3 -c "
import json, sys
try:
    from jsonschema import validate, ValidationError, Draft202012Validator
except ImportError:
    print('ERROR: jsonschema not installed. Run: pip install jsonschema')
    sys.exit(2)

with open('$file') as f:
    data = json.load(f)
with open('$schema') as f:
    schema = json.load(f)

try:
    validate(instance=data, schema=schema, cls=Draft202012Validator)
    print('PASS')
except ValidationError as e:
    print(f'FAIL: {e.message}')
    if e.absolute_path:
        print(f'  Path: {\"/\".join(str(p) for p in e.absolute_path)}')
" 2>&1)

  if echo "$result" | grep -q "^PASS$"; then
    echo "  ✅ $file"
    return 0
  elif echo "$result" | grep -q "^ERROR:"; then
    echo "  ⚠️  $result"
    return 2
  else
    echo "  ❌ $file"
    echo "$result" | sed 's/^/     /'
    ERRORS=$((ERRORS + 1))
    return 1
  fi
}

validate_jsonl_against_schema() {
  local file="$1"
  local schema="$2"
  local line_num=0
  local line_errors=0

  while IFS= read -r line; do
    line_num=$((line_num + 1))
    if [ -z "$line" ]; then continue; fi

    local result
    result=$(echo "$line" | python3 -c "
import json, sys
try:
    from jsonschema import validate, ValidationError, Draft202012Validator
except ImportError:
    print('ERROR: jsonschema not installed')
    sys.exit(2)

data = json.loads(sys.stdin.read())
with open('$schema') as f:
    schema = json.load(f)

try:
    validate(instance=data, schema=schema, cls=Draft202012Validator)
    print('PASS')
except ValidationError as e:
    print(f'FAIL: {e.message}')
" 2>&1)

    if ! echo "$result" | grep -q "^PASS$"; then
      echo "  ❌ $file line $line_num: $result"
      line_errors=$((line_errors + 1))
    fi
  done < "$file"

  if [ $line_errors -eq 0 ]; then
    echo "  ✅ $file ($line_num lines)"
  fi
  ERRORS=$((ERRORS + line_errors))
}

# ─── File-to-schema mapping ────────────────────────────────────────────────

schema_for_file() {
  local file="$1"
  local basename
  basename=$(basename "$file")

  case "$basename" in
    task-ledger.json)       echo "$SCHEMA_DIR/task-ledger.schema.json" ;;
    context-packet.json)    echo "$SCHEMA_DIR/context-packet.schema.json" ;;
    command-intent.json)    echo "$SCHEMA_DIR/command-intent.schema.json" ;;
    current-intent.json)    echo "$SCHEMA_DIR/current-intent.schema.json" ;;
    repo-practices.json)    echo "$SCHEMA_DIR/repo-practices.schema.json" ;;
    known-issues.json)      echo "$SCHEMA_DIR/known-issues.schema.json" ;;
    active-plan.json)       echo "$SCHEMA_DIR/active-plan.schema.json" ;;
    execution-brief.json)   echo "$SCHEMA_DIR/execution-brief.schema.json" ;;
    test-spec.json)         echo "$SCHEMA_DIR/test-spec.schema.json" ;;
    learning-inbox.jsonl)   echo "$SCHEMA_DIR/learning-entry.schema.json" ;;
    TASK-*.json)            echo "$SCHEMA_DIR/task-result.schema.json" ;;
    REVIEW-*.json)          echo "$SCHEMA_DIR/review-result.schema.json" ;;
    M-*.json)               echo "$SCHEMA_DIR/milestone.schema.json" ;;
    *)                      echo "" ;;
  esac
}

# ─── Commands ───────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Validate Claude Coordinator state files against JSON schemas.

Options:
  <file>              Validate a specific JSON file
  --all               Validate all state files in .coord/ and docs/
  --schema <name>     Validate stdin against a named schema (e.g. "task-ledger")
  --list-schemas      List all available schemas
  --help              Show this help

Requires: python3 -m pip install jsonschema
EOF
}

if [ $# -eq 0 ]; then
  usage
  exit 0
fi

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
  --list-schemas)
    echo "Available schemas:"
    for f in "$SCHEMA_DIR"/*.schema.json; do
      name=$(basename "$f" .schema.json)
      title=$(python3 -c "import json; print(json.load(open('$f')).get('title',''))" 2>/dev/null || echo "")
      echo "  $name — $title"
    done
    exit 0
    ;;
  --schema)
    schema_name="${2:-}"
    if [ -z "$schema_name" ]; then
      echo "Error: --schema requires a schema name"
      exit 1
    fi
    schema_file="$SCHEMA_DIR/${schema_name}.schema.json"
    if [ ! -f "$schema_file" ]; then
      echo "Error: Schema not found: $schema_file"
      exit 1
    fi
    tmpfile=$(mktemp)
    cat > "$tmpfile"
    validate_against_schema "$tmpfile" "$schema_file"
    rm -f "$tmpfile"
    exit $ERRORS
    ;;
  --all)
    echo "Validating all state files..."
    echo ""

    # .coord/ files
    if [ -d .coord ]; then
      echo "── .coord/ ──"
      for f in .coord/*.json .coord/*.jsonl; do
        [ -f "$f" ] || continue
        schema=$(schema_for_file "$f")
        if [ -z "$schema" ]; then
          echo "  ⚠️  SKIP: No schema for $f"
          continue
        fi
        if [[ "$f" == *.jsonl ]]; then
          validate_jsonl_syntax "$f" && validate_jsonl_against_schema "$f" "$schema"
        else
          validate_json_syntax "$f" && validate_against_schema "$f" "$schema"
        fi
      done

      # Task results
      for f in .coord/tasks/TASK-*.json; do
        [ -f "$f" ] || continue
        schema=$(schema_for_file "$f")
        validate_json_syntax "$f" && validate_against_schema "$f" "$schema"
      done

      # Reviews
      for f in .coord/reviews/REVIEW-*.json; do
        [ -f "$f" ] || continue
        schema=$(schema_for_file "$f")
        validate_json_syntax "$f" && validate_against_schema "$f" "$schema"
      done

      # Milestones
      for f in .coord/milestones/M-*.json; do
        [ -f "$f" ] || continue
        schema=$(schema_for_file "$f")
        validate_json_syntax "$f" && validate_against_schema "$f" "$schema"
      done
      echo ""
    else
      echo "── .coord/ not found (fresh session) ──"
      echo ""
    fi

    # docs/ files
    if [ -d docs ]; then
      echo "── docs/ ──"
      for f in docs/context/*.json docs/plans/*.json; do
        [ -f "$f" ] || continue
        schema=$(schema_for_file "$f")
        if [ -z "$schema" ]; then
          echo "  ⚠️  SKIP: No schema for $f"
          continue
        fi
        validate_json_syntax "$f" && validate_against_schema "$f" "$schema"
      done
      echo ""
    else
      echo "── docs/ not found ──"
      echo ""
    fi

    # Summary
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ $ERRORS -eq 0 ]; then
      echo "✅ All files valid"
    else
      echo "❌ $ERRORS validation error(s) found"
    fi
    exit $ERRORS
    ;;
  *)
    # Single file validation
    file="$1"
    if [ ! -f "$file" ]; then
      echo "Error: File not found: $file"
      exit 1
    fi
    schema=$(schema_for_file "$file")
    if [ -z "$schema" ]; then
      echo "Error: No schema mapping for $file"
      exit 1
    fi
    if [[ "$file" == *.jsonl ]]; then
      validate_jsonl_syntax "$file" && validate_jsonl_against_schema "$file" "$schema"
    else
      validate_json_syntax "$file" && validate_against_schema "$file" "$schema"
    fi
    exit $ERRORS
    ;;
esac
