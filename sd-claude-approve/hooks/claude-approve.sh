#!/bin/bash
# Claude Code PermissionRequest hook — fires ONLY when a permission dialog
# is about to be shown. Writes pending info for Stream Deck, then blocks
# waiting for the user to press the Stream Deck button (or timeout).

PENDING_FILE="/tmp/claude-sd-pending.json"
RESPONSE_FILE="/tmp/claude-sd-response"
TIMEOUT=60

/usr/bin/python3 -c '
import json, sys, os, time

data = json.load(sys.stdin)

tool_name = data.get("tool_name", "")
tool_input = data.get("tool_input", {})

pending_file = os.environ.get("SD_PENDING_FILE", "/tmp/claude-sd-pending.json")
info = {
    "tool_name": tool_name,
    "tool_input": tool_input,
    "timestamp": time.time(),
}
with open(pending_file, "w") as f:
    json.dump(info, f)
' <<< "$( cat )" 2>/dev/null

# Clean up any stale response
rm -f "$RESPONSE_FILE"

# Wait for Stream Deck button press
SECONDS=0
while [ $SECONDS -lt $TIMEOUT ]; do
  if [ -f "$RESPONSE_FILE" ]; then
    DECISION=$(cat "$RESPONSE_FILE")
    rm -f "$RESPONSE_FILE" "$PENDING_FILE"

    if [ "$DECISION" = "approve" ]; then
      echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
      exit 0
    else
      echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny"}}}'
      exit 0
    fi
  fi
  sleep 0.3
done

# Timeout — clean up and deny (safe default)
rm -f "$PENDING_FILE"
echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny"}}}'
exit 0
