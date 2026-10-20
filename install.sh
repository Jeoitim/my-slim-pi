#!/usr/bin/env bash
set -euo pipefail
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' 2>/dev/null; then
  node_bin=''
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.local/bin/node /usr/local/bin/node /usr/bin/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' 2>/dev/null; then node_bin="$candidate"; break; fi
  done
fi
if [[ -z "$node_bin" ]]; then printf '%s\n' '需要 Node.js 24+ 和 npm。请先安装或激活用户级 Node；无需全局安装 Pi。' >&2; exit 1; fi
export PATH="$(dirname -- "$node_bin"):$PATH"
exec "$node_bin" "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/install-linux.mjs" "$@"
