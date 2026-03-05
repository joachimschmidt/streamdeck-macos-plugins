#!/bin/bash
set -e

PLUGIN_ID="com.local.claude-approve"
PLUGIN_DIR="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/${PLUGIN_ID}.sdPlugin"
HOOK_SRC="$(cd "$(dirname "$0")" && pwd)/hooks/claude-approve.sh"

echo "Building plugin..."
npm run build

echo "Stopping Stream Deck..."
pkill -f "Stream Deck" 2>/dev/null || true
sleep 2

echo "Installing to: $PLUGIN_DIR"
rm -rf "$PLUGIN_DIR"
cp -r "${PLUGIN_ID}.sdPlugin" "$PLUGIN_DIR"

echo "Starting Stream Deck..."
open -a "Elgato Stream Deck"

# Auto-configure the Claude Code hook in ~/.claude/settings.json
SETTINGS_FILE="$HOME/.claude/settings.json"
echo ""
echo "Configuring Claude Code hook..."

export SD_HOOK_PATH="$HOOK_SRC"
/usr/bin/python3 -c '
import json, os

settings_file = os.path.expanduser("~/.claude/settings.json")
hook_path = os.environ["SD_HOOK_PATH"]

# Read existing settings or start fresh
if os.path.isfile(settings_file):
    with open(settings_file) as f:
        settings = json.load(f)
else:
    os.makedirs(os.path.dirname(settings_file), exist_ok=True)
    settings = {}

hooks = settings.setdefault("hooks", {})
pre_tool = hooks.setdefault("PermissionRequest", [])

# Check if the hook is already configured (with correct or incorrect path)
found = False
for entry in pre_tool:
    for h in entry.get("hooks", []):
        cmd = h.get("command", "")
        if "claude-approve.sh" in cmd:
            if cmd != hook_path:
                h["command"] = hook_path
                print(f"  Updated hook path: {hook_path}")
            else:
                print(f"  Hook already configured correctly.")
            found = True
            break
    if found:
        break

if not found:
    pre_tool.append({
        "matcher": "",
        "hooks": [{"type": "command", "command": hook_path}]
    })
    print(f"  Added hook: {hook_path}")

with open(settings_file, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
'

echo ""
echo "Done! 'Claude Approve' should appear under 'Claude' category."
