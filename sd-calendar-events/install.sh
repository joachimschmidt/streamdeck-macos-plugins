#!/bin/bash
set -e

PLUGIN_ID="com.local.calendar-events"
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
echo "Done! The 'Calendar Events' action should now appear"
echo "under the 'Google Calendar' category in your Stream Deck app."
echo ""
echo "Add it to a dial — it reads from macOS Calendar automatically."
echo "Select which calendars to show in the action settings."
echo ""
echo "Note: On first run, macOS will ask for calendar access permission."
