#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/voice-bridge"
CONFERENCE_SINK="${VOICE_BRIDGE_CONFERENCE_SINK:-voice_bridge_conference}"
AGENT_SINK="${VOICE_BRIDGE_AGENT_SINK:-voice_bridge_agent}"
HOST_SINK="${VOICE_BRIDGE_HOST_SINK:-}"
HOST_MIC="${VOICE_BRIDGE_HOST_MIC:-}"

usage() {
  cat <<'EOF'
Usage: tools/audio-bridge.sh <start|stop|status> [--dry-run] [--json]

start creates two local PipeWire/PulseAudio-compatible sinks:
  Voice Bridge Conference Capture  - choose this as the conferencing app speaker.
  Voice Bridge Agent Microphone    - isolated agent-only virtual microphone.

Approved agent WAV audio is sent to the agent sink by pw-cat. The operator microphone remains a
separate physical source. route-client-audio.sh switches communication apps between those inputs.
The Conference Capture sink is looped to the physical output so the user continues to hear the call.
EOF
}

require_pactl() {
  command -v pactl >/dev/null || { echo "pactl is required (PipeWire PulseAudio compatibility is supported)." >&2; exit 1; }
}

load_module() {
  local name="$1"
  shift
  pactl load-module "$name" "$@"
}

unload_module_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    pactl unload-module "$(<"$file")" >/dev/null 2>&1 || true
    rm -f "$file"
  fi
}

status() {
  local active=false
  [[ -f "$STATE_DIR/conference-sink.module" && -f "$STATE_DIR/agent-sink.module" ]] && active=true
  if [[ "${1:-}" == "--json" ]]; then
    printf '{"active":%s,"conferenceSink":"%s","conferenceMonitor":"%s.monitor","agentSink":"%s","agentMicrophone":"%s.monitor","operatorMicrophone":"%s"}\n' \
      "$active" "$CONFERENCE_SINK" "$CONFERENCE_SINK" "$AGENT_SINK" "$AGENT_SINK" "${HOST_MIC:-$(cat "$STATE_DIR/operator-source" 2>/dev/null || true)}"
  else
    printf 'active: %s\nconference speaker device: %s\nconference capture source: %s.monitor\nagent microphone: %s.monitor\n' \
      "$active" "$CONFERENCE_SINK" "$CONFERENCE_SINK" "$AGENT_SINK"
  fi
}

start() {
  require_pactl
  HOST_SINK="${HOST_SINK:-$(pactl get-default-sink)}"
  HOST_MIC="${HOST_MIC:-$(pactl get-default-source)}"
  if [[ -f "$STATE_DIR/conference-sink.module" ]]; then
    echo "Voice Bridge audio devices are already active."
    status
    return
  fi

  mkdir -p "$STATE_DIR"
  local created=()
  cleanup_on_error() {
    for module in "${created[@]:-}"; do pactl unload-module "$module" >/dev/null 2>&1 || true; done
    rm -f "$STATE_DIR"/*.module
  }
  trap cleanup_on_error ERR

  local conference_sink agent_sink conference_loopback
  conference_sink="$(load_module module-null-sink "sink_name=$CONFERENCE_SINK" "sink_properties=device.description=Voice_Bridge_Conference_Capture")"
  created+=("$conference_sink")
  printf '%s' "$conference_sink" > "$STATE_DIR/conference-sink.module"

  agent_sink="$(load_module module-null-sink "sink_name=$AGENT_SINK" "sink_properties=device.description=Voice_Bridge_Agent_Microphone")"
  created+=("$agent_sink")
  printf '%s' "$agent_sink" > "$STATE_DIR/agent-sink.module"

  conference_loopback="$(load_module module-loopback "source=$CONFERENCE_SINK.monitor" "sink=$HOST_SINK")"
  created+=("$conference_loopback")
  printf '%s' "$conference_loopback" > "$STATE_DIR/conference-loopback.module"

  printf '%s' "$HOST_MIC" > "$STATE_DIR/operator-source"
  [[ -f "$STATE_DIR/selected-input" ]] || printf '%s' "operator" > "$STATE_DIR/selected-input"
  trap - ERR

  echo "Voice Bridge audio devices created."
  status
}

stop() {
  require_pactl
  unload_module_file "$STATE_DIR/microphone-loopback.module"
  unload_module_file "$STATE_DIR/conference-loopback.module"
  unload_module_file "$STATE_DIR/agent-sink.module"
  unload_module_file "$STATE_DIR/conference-sink.module"
  rm -f "$STATE_DIR/operator-source" "$STATE_DIR/selected-input"
  rmdir "$STATE_DIR" >/dev/null 2>&1 || true
  echo "Voice Bridge audio devices removed."
}

command_name="${1:-}"
shift || true
dry_run=false
json=false
for option in "$@"; do
  [[ "$option" == "--dry-run" ]] && dry_run=true
  [[ "$option" == "--json" ]] && json=true
done

case "$command_name" in
  start)
    if "$dry_run"; then
      echo "Would create $CONFERENCE_SINK, $AGENT_SINK, and their loopback routes."
      status
    else
      start
    fi
    ;;
  stop)
    if "$dry_run"; then echo "Would remove Voice Bridge PipeWire modules from $STATE_DIR."; else stop; fi
    ;;
  status) status "$([[ "$json" == true ]] && echo --json)" ;;
  *) usage; exit 2 ;;
esac