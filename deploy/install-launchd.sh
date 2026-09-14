#!/bin/sh
# Installs Musik as a launchd user agent on macOS: starts at login, restarts on crash.
# Run from anywhere after `npm ci && npm run build`:  sh deploy/install-launchd.sh
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node) || { echo "node not found in PATH" >&2; exit 1; }
LABEL=com.musik.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[ -f "$REPO/dist/index.html" ] || { echo "dist/ missing - run 'npm run build' first" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__NODE__|$NODE|g" -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" \
  "$REPO/deploy/$LABEL.plist" > "$PLIST"

# Reload if already installed.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed $PLIST"
echo "Server: http://localhost:3000  Logs: $HOME/Library/Logs/musik.log"
