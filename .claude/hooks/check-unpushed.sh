#!/bin/bash
# Stop hook: if the Timer repo has uncommitted or unpushed work when Claude
# finishes a turn, send it back to test, commit and push. Fires once per turn
# (stop_hook_active guard) so a failing test can be reported, not looped on.

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "$(dirname "$0")/../.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

dirty=$(git status --porcelain)
ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)

if [ -n "$dirty" ] || [ "$ahead" != "0" ]; then
  jq -n --arg r "Circuit Timer repo ($(pwd)) has unpushed changes. Run npm test; if it passes, commit with a clear message and git push so it goes live. If tests fail, or Andrew asked to hold off, say so instead of pushing." \
    '{decision: "block", reason: $r}'
fi
exit 0
