#!/usr/bin/env bash
set -euo pipefail

required=(node pnpm)
optional=(aws sam ccloud cockroach jq docker)
missing=0

echo "Required local-development tools"
for tool in "${required[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '  [ok] %-12s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '  [missing] %s\n' "$tool"
    missing=1
  fi
done

echo "Cloud/deployment tools (optional until deployment)"
for tool in "${optional[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '  [ok] %-12s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '  [not installed] %s\n' "$tool"
  fi
done
if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  echo "  [not running] Docker daemon (required by make deploy for Linux arm64 packaging)"
fi

if command -v python3.12 >/dev/null 2>&1; then
  python_cmd=python3.12
elif command -v python3 >/dev/null 2>&1; then
  python_cmd=python3
else
  python_cmd=""
fi
if [[ -n "$python_cmd" ]]; then
  printf '  [ok] %-12s %s\n' "Python" "$(command -v "$python_cmd")"
  python_version=$($python_cmd -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
else
  python_version=missing
fi
node_version=$(node -p 'process.versions.node' 2>/dev/null || echo missing)
if [[ -z "$python_cmd" ]] || ! "$python_cmd" -c 'import sys; raise SystemExit(sys.version_info < (3, 12))'; then
  echo "[error] Python 3.12+ is required; found $python_version" >&2
  missing=1
fi
if ! node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22 && (b>13 || (b===13 && c>=0))) ? 0 : 1)' 2>/dev/null; then
  echo "[error] Node.js 22.13.0+ is required; found $node_version" >&2
  missing=1
fi

if (( missing != 0 )); then
  echo "Install the required tools above, then rerun make check." >&2
  exit 1
fi

echo "Prerequisite check passed."
