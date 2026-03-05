#!/bin/bash
# Claude Code PreToolUse hook — writes pending tool to file, waits for SD button approval
# Only blocks when the tool would actually need user permission.

PENDING_FILE="/tmp/claude-sd-pending.json"
RESPONSE_FILE="/tmp/claude-sd-response"
TIMEOUT=30  # seconds to wait before falling through

# Read full hook input from stdin, then delegate to Python for permission checking
INPUT=$(cat)

# Python does all the heavy lifting: parses input, checks permission mode,
# reads project + user settings for allowed tools, and decides whether to block
SHOULD_BLOCK=$(/usr/bin/python3 -c "
import json, sys, os, fnmatch, re

data = json.loads('''$( echo "$INPUT" | sed "s/'/\\\\'/g" )''')

tool_name = data.get('tool_name', '')
tool_input = data.get('tool_input', {})
permission_mode = data.get('permission_mode', 'default')
cwd = data.get('cwd', '')

# Permissive modes — never block
if permission_mode in ('bypassPermissions', 'dontAsk'):
    print('no')
    sys.exit(0)

# Read-only / non-destructive tools — never block
non_blocking = {
    'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent',
    'TaskList', 'TaskGet', 'TaskCreate', 'TaskUpdate',
    'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
    'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Skill',
}
if tool_name in non_blocking:
    print('no')
    sys.exit(0)

# Build the permission pattern for this tool call
# Format: 'ToolName' or 'Bash(command:*)' etc.
def build_tool_pattern(name, inp):
    if name == 'Bash':
        cmd = inp.get('command', '')
        return f'Bash({cmd})'
    elif name == 'Edit':
        fp = inp.get('file_path', '')
        return f'Edit({fp})'
    elif name == 'Write':
        fp = inp.get('file_path', '')
        return f'Write({fp})'
    elif name == 'NotebookEdit':
        fp = inp.get('notebook_path', '')
        return f'NotebookEdit({fp})'
    return name

tool_pattern = build_tool_pattern(tool_name, tool_input)

def matches_allowed(tool_pattern, allowed_list, tool_name, tool_input):
    \"\"\"Check if the tool call matches any pattern in the allowed list.\"\"\"
    for pattern in allowed_list:
        # Exact match (e.g., 'WebSearch')
        if pattern == tool_name:
            return True

        # Pattern with args: 'Bash(command:*)', 'Edit(path:*)', etc.
        # Extract the tool and the pattern inside parens
        m = re.match(r'^(\w+)\((.+)\)$', pattern)
        if not m:
            continue

        pat_tool = m.group(1)
        pat_args = m.group(2)

        if pat_tool != tool_name:
            continue

        if tool_name == 'Bash':
            cmd = tool_input.get('command', '')
            # Pattern like 'git:*' means command starts with 'git'
            # Pattern like 'echo:*' means command starts with 'echo'
            if pat_args.endswith(':*'):
                prefix = pat_args[:-2]  # remove ':*'
                if cmd.startswith(prefix) or cmd.lstrip().startswith(prefix):
                    return True
            elif cmd == pat_args or cmd.strip() == pat_args:
                return True
        elif tool_name in ('Edit', 'Write', 'NotebookEdit'):
            fp = tool_input.get('file_path', '') or tool_input.get('notebook_path', '')
            if pat_args.endswith(':*'):
                prefix = pat_args[:-2]
                if fp.startswith(prefix):
                    return True
            elif fp == pat_args:
                return True
    return False

# Collect allowed patterns from all settings files
allowed = []

# 1. Project-level settings: <cwd>/.claude/settings.local.json
if cwd:
    for fname in ['settings.local.json', 'settings.json']:
        p = os.path.join(cwd, '.claude', fname)
        if os.path.isfile(p):
            try:
                with open(p) as f:
                    s = json.load(f)
                allowed.extend(s.get('permissions', {}).get('allow', []))
            except:
                pass

# 2. User-level settings: ~/.claude/settings.local.json and ~/.claude/settings.json
home = os.path.expanduser('~')
for fname in ['settings.local.json', 'settings.json']:
    p = os.path.join(home, '.claude', fname)
    if os.path.isfile(p):
        try:
            with open(p) as f:
                s = json.load(f)
            allowed.extend(s.get('permissions', {}).get('allow', []))
        except:
            pass

# Check if tool is already allowed
if matches_allowed(tool_pattern, allowed, tool_name, tool_input):
    print('no')
else:
    print('yes')
" 2>/dev/null)

# If already permitted, pass through
if [ "$SHOULD_BLOCK" != "yes" ]; then
    exit 0
fi

# Extract tool info for the SD plugin display
TOOL_NAME=$(echo "$INPUT" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | /usr/bin/python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('tool_input',{})))" 2>/dev/null)

# Clean up any stale response file
rm -f "$RESPONSE_FILE"

# Write pending info for SD plugin to read
/usr/bin/python3 -c "
import json, time
info = {
    'tool_name': '$TOOL_NAME',
    'tool_input': $TOOL_INPUT,
    'timestamp': time.time()
}
with open('$PENDING_FILE', 'w') as f:
    json.dump(info, f)
"

# Wait for approval from SD button (polls for response file)
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if [ -f "$RESPONSE_FILE" ]; then
    DECISION=$(cat "$RESPONSE_FILE")
    rm -f "$RESPONSE_FILE" "$PENDING_FILE"

    if [ "$DECISION" = "approve" ]; then
      # Auto-approve: bypass Claude's permission prompt
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Approved via Stream Deck"}}'
      exit 0
    else
      # Deny
      echo "Denied via Stream Deck" >&2
      exit 2
    fi
  fi
  sleep 0.3
  ELAPSED=$((ELAPSED + 1))
done

# Timeout — clean up and fall through to normal permission handling
rm -f "$PENDING_FILE"
exit 0
