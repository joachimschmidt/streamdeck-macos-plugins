#!/bin/bash
set -e

PLUGIN_ID="com.local.bt-connect"
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
echo "Done! The 'BT Connect' action should now appear"
echo "under the 'Bluetooth' category in your Stream Deck app."
echo ""
echo "Add it to a key, select your device in settings, tap to connect/disconnect."
