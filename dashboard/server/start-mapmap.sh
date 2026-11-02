#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"
export MAPMAP_TOKEN_FILE="${MAPMAP_TOKEN_FILE:-$repo_dir/dashboard/data/mcp.token}"
mkdir -p "$(dirname "$MAPMAP_TOKEN_FILE")"
args=(--mcp-port 49452)
profile="$repo_dir/dashboard/data/profiles/tabletop.mmp"
if [[ -f "$profile" ]]; then
  args+=("$profile")
  # Do not put the projector image on another monitor if the projector is absent.
  if python3 - "$repo_dir/dashboard/data/settings.json" <<'PYDISPLAY'
import json,sys,subprocess
try:
    name=json.load(open(sys.argv[1]))['selectedDisplay']
    lines=subprocess.check_output(['xrandr','--query'],text=True).splitlines()
    sys.exit(0 if any(line.startswith(name+' connected') for line in lines) else 1)
except Exception:sys.exit(1)
PYDISPLAY
  then args+=(--fullscreen); fi
fi
exec "$repo_dir/mapmap" "${args[@]}"
