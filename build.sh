#!/bin/sh
# Writes dist/: a copy of app/ with the current commit stamped in (R6) and config.js filled from
# the session file outside the repo (the session is never committed). Usage: ./build.sh [session-file]
set -eu
cd "$(dirname "$0")"
session_file=${1:-../session.txt}
sha=$(git rev-parse HEAD)
rm -rf dist && cp -R app dist
sed -i.bak "s/__BUILD_SHA__/$sha/g" dist/index.html && rm dist/index.html.bak
cat > dist/config.js <<CFG
export const API = 'https://hq.mega.dev/challenges/show-me-when/api';
export const SESSION = '$(cat "$session_file")';
CFG
echo "built dist/ at $sha"
