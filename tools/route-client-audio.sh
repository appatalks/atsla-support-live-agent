#!/usr/bin/env bash
set -euo pipefail

CONFERENCE_SINK="${VOICE_BRIDGE_CONFERENCE_SINK:-voice_bridge_conference}"
AGENT_SOURCE="${VOICE_BRIDGE_AGENT_SOURCE:-voice_bridge_agent.monitor}"
CLIENT_PATTERN="${VOICE_BRIDGE_CLIENT_PATTERN:-Google Chrome|Chromium|Microsoft Teams|teams-for-linux}"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/voice-bridge"
OPERATOR_SOURCE="${VOICE_BRIDGE_OPERATOR_SOURCE:-$(cat "$STATE_DIR/operator-source" 2>/dev/null || pactl get-default-source)}"

require_tools() {
  command -v pactl >/dev/null || { echo "pactl is required." >&2; exit 1; }
  command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
}

matching_playback_ids() {
  pactl -f json list sink-inputs | jq -r --arg pattern "$CLIENT_PATTERN" '
    .[] | select(((.properties["application.name"] // "") + " " + (.properties["application.process.binary"] // "")) | test($pattern; "i")) | .index
  '
}

matching_capture_ids() {
  pactl -f json list source-outputs | jq -r --arg pattern "$CLIENT_PATTERN" '
    .[] | select(((.properties["application.name"] // "") + " " + (.properties["application.process.binary"] // "")) | test($pattern; "i")) | .index
  '
}

wire() {
  local input_mode="${1:-$(cat "$STATE_DIR/selected-input" 2>/dev/null || echo operator)}"
  [[ "$input_mode" == "operator" || "$input_mode" == "agent" ]] || { echo "Input mode must be operator or agent." >&2; exit 2; }
  local capture_source="$OPERATOR_SOURCE"
  [[ "$input_mode" == "agent" ]] && capture_source="$AGENT_SOURCE"
  require_tools
  local moved_playback=0
  local moved_capture=0
  while IFS= read -r stream_id; do
    [[ -n "$stream_id" ]] || continue
    pactl move-sink-input "$stream_id" "$CONFERENCE_SINK"
    ((moved_playback += 1))
  done < <(matching_playback_ids)
  while IFS= read -r stream_id; do
    [[ -n "$stream_id" ]] || continue
    pactl move-source-output "$stream_id" "$capture_source"
    ((moved_capture += 1))
  done < <(matching_capture_ids)
  mkdir -p "$STATE_DIR"
  printf '%s' "$input_mode" > "$STATE_DIR/selected-input"
  printf '{"playbackStreamsRouted":%d,"microphoneStreamsRouted":%d,"conferenceSink":"%s","inputMode":"%s","inputSource":"%s","operatorSource":"%s","agentSource":"%s"}\n' \
    "$moved_playback" "$moved_capture" "$CONFERENCE_SINK" "$input_mode" "$capture_source" "$OPERATOR_SOURCE" "$AGENT_SOURCE"
}

status() {
  require_tools
  local input_mode="$(cat "$STATE_DIR/selected-input" 2>/dev/null || echo operator)"
  local expected_source="$OPERATOR_SOURCE"
  [[ "$input_mode" == "agent" ]] && expected_source="$AGENT_SOURCE"
  local conference_id expected_source_id
  conference_id="$(pactl -f json list sinks | jq -r --arg name "$CONFERENCE_SINK" '.[] | select(.name == $name) | .index' | head -1)"
  expected_source_id="$(pactl -f json list sources | jq -r --arg name "$expected_source" '.[] | select(.name == $name) | .index' | head -1)"
  local playback_json capture_json
  playback_json="$(pactl -f json list sink-inputs)"
  capture_json="$(pactl -f json list source-outputs)"
  jq -n \
    --arg pattern "$CLIENT_PATTERN" \
    --arg inputMode "$input_mode" \
    --arg inputSource "$expected_source" \
    --argjson conferenceId "${conference_id:-0}" \
    --argjson expectedSourceId "${expected_source_id:-0}" \
    --argjson playback "$playback_json" \
    --argjson capture "$capture_json" '
      def matches: ((.properties["application.name"] // "") + " " + (.properties["application.process.binary"] // "")) | test($pattern; "i");
      ($playback | map(select(matches))) as $playbackStreams |
      ($capture | map(select(matches))) as $captureStreams |
      {
        inputMode: $inputMode,
        inputSource: $inputSource,
        playbackStreams: ($playbackStreams | length),
        playbackStreamsRouted: ($playbackStreams | map(select(.sink == $conferenceId)) | length),
        microphoneStreams: ($captureStreams | length),
        microphoneStreamsRouted: ($captureStreams | map(select(.source == $expectedSourceId)) | length)
      }
    '
}

case "${1:-wire}" in
  wire) wire "${2:-}" ;;
  status) status ;;
  *) echo "Usage: tools/route-client-audio.sh [wire|status]" >&2; exit 2 ;;
esac