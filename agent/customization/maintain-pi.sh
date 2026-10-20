#!/usr/bin/env bash
set -euo pipefail
customization_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node_bin=''
if [[ -f "$customization_dir/../install/node-path" ]]; then IFS= read -r node_bin < "$customization_dir/../install/node-path"; fi
if [[ "$node_bin" != /* || ! -x "$node_bin" ]]; then node_bin="$(command -v node || true)"; fi
if [[ -z "$node_bin" ]]; then printf '%s\n' '需要 Node.js 24+；请重新运行 Bash 安装器修复。' >&2; exit 1; fi
export PATH="$(dirname -- "$node_bin"):$PATH"
exec "$node_bin" "$customization_dir/runtime/maintenance.mjs" "$@"
