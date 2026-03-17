#!/bin/bash
set -e

PLUGIN_ID="com.local.claude-usage"
PLUGIN_DIR="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/${PLUGIN_ID}.sdPlugin"

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
echo "Done! 'Claude Usage' should appear under 'Development' category."
