#!/bin/bash
# tests/run.sh: syntax check every script, then the end-to-end browser test. Use this, not e2e.py alone.
set -e
cd "$(dirname "$0")/.."
for f in src/*.js; do $HOME/.local/node/bin/node --check "$f"; done
echo "syntax ok"
exec tests/fx.sh tests/e2e.py "$@"
