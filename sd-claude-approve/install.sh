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

echo ""
echo "Done! 'Claude Approve' should appear under 'Claude' category."
echo ""
echo "=== IMPORTANT: Add the hook to Claude Code ==="
echo ""
echo "Add this to ~/.claude/settings.json:"
echo ""
cat << 'SETTINGS'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "HOOK_PATH"
          }
        ]
      }
    ]
  }
}
SETTINGS
echo ""
echo "Replace HOOK_PATH with:"
echo "  $HOOK_SRC"
echo ""
