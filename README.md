# Voice Bridge

Voice Bridge is a local meeting-assistant test bed. It keeps the conferencing platform separate from the AI layer: a future PipeWire adapter supplies transcript events, the coordinator creates a response, and a policy gate decides whether the text is merely suggested, needs approval, or may be spoken through a local voice bridge.

The repository is ready to test without Microsoft Teams, a local model, or virtual audio devices. Its default provider and voice output are deterministic simulators.

## Quick start

```bash
npm install
npm test
npm run typecheck
npm run simulate
npm start
```

Open `http://127.0.0.1:4173`. The **Voice Bridge Lab** dashboard submits simulated remote transcript text and shows the policy, draft, authorization, and simulated speech dispatch.

## Desktop App

Use the standalone Electron window instead of a browser tab:

```bash
npm run desktop
```

The desktop shell opens the locally running Voice Bridge service in its own application window. Its **Voice Bridge > Wire Teams Browser Audio** menu action, and the **Wire Call Audio** control in the window, route active Chrome, Chromium, or Teams streams into `voice_bridge_conference` and route their microphone capture to `voice_bridge_agent.monitor`. Run that action after joining a browser-based Teams meeting, or whenever Teams reconnects its audio devices.

The desktop opens at `1520x980` with a persistent **Sessions** rail on the left. Sessions are saved as JSON under `~/.local/share/voice-bridge/sessions/`, can be searched, and can be selected later to restore transcript, proposed/spoken replies, activity, and escalation history. Creating a session routes the call to Agent mic and sends the standard Appatalks greeting exactly once before normal session conversation. Merely opening the app does not send a greeting; the operator explicitly starts the session.

New and migrated installations default to **Autonomous** response mode and **Agent mic**. Later operator changes are persisted. A live-representative request cancels pending autonomous work, discards any stale model response, and tells the caller only: `Absolutely. I'm notifying a live representative now. Please hold for just a moment.` The operator alert then remains visible until acknowledged or taken over.

## Start And Stop

Use the supervisor instead of manually opening Python, Node, Electron, and Whisper terminals:

```bash
npm run app:start
npm run app:status
npm run app:stop
```

`app:start` starts the local Qwen bridge, Appatalks voice bridge, optional authenticated Copilot ACP bridge, API, Whisper capture, audio devices, and desktop window under one process tree. Closing the desktop window, or running `app:stop`, terminates those children and removes the Linux virtual devices. Runtime logs are written to `~/.local/state/voice-bridge/` by default.

### Microphone Selection

On Linux, Voice Bridge creates two distinct call inputs:

| Input | Purpose |
| --- | --- |
| Physical operator source | Your real microphone; no generated agent audio is mixed into it. |
| `voice_bridge_agent.monitor` | Isolated Appatalks agent microphone; only authorized/generated agent output is sent here. |

Use the **Operator mic** / **Agent mic** toggle in the main desktop view to move the active Teams, Zoom, Slack, or browser call between these sources. The app defaults to **Operator mic** after starting. The generated-agent microphone is not a blend with the operator microphone.

On macOS, install and configure a virtual audio device such as [BlackHole](https://existential.audio/blackhole/) before live call output. Point the communication client at your physical mic for operator turns or at the configured virtual agent device for agent turns. Set `VOICE_BRIDGE_MAC_AGENT_DEVICE` to the numeric CoreAudio/`afplay -d` device ID for the virtual agent output, or make the BlackHole/Multi-Output device the default system output. The Linux PipeWire routing scripts are intentionally not run on macOS.

### Client Workspaces And Profiles

Use **Settings** in the standalone window to select an existing client folder or create one from a client name. A new workspace starts with:

```text
client-profile.json
knowledge/
skills/
meetings/
```

The local Qwen agent reads `.md`, `.txt`, and `.json` knowledge and skill files from the selected workspace for each reply. Enable **Save transcript in client folder** to store remote and agent turns in `meetings/` and update `client-profile.json` with conversation activity. Use **Write meeting summary** to generate and save a decisions, questions, and next-steps summary.

Settings also provides four locally supported Qwen choices, multiple named agent profiles with tone, voice-style, and custom instructions, and an end-of-turn pause for autonomous mode. In **Autonomous** mode, the agent waits for the configured silence interval after remote speech before responding; direct references to `agent`, `assistant`, or `eva` respond immediately. The default **Approve** mode keeps every reply behind the operator control.

The **Reasoning provider** setting switches at runtime between Local Qwen and the authenticated GitHub Copilot CLI ACP bridge. Copilot model choices include automatic selection and explicit configured model names; actual access depends on the operator's Copilot plan. Switching providers does not require restarting Voice Bridge.

Copilot options include GPT-5.6 Terra and GPT-5.6 Luna alongside automatic selection, GPT-5.4, Claude Sonnet, and GPT-4.1. The ACP bridge forwards the selected identifier to Copilot; the operator's license ultimately determines whether an explicit model is available.

**Monitor** mode is intentionally passive: it listens, transcribes, displays, and optionally logs the conversation, but never generates or speaks a reply. Operator response templates remain available because they are explicit manual commands. **Approve** prepares agent replies for review, while **Autonomous** generates and speaks after the configured end-of-turn pause.

When summary retention is enabled and a client workspace is selected, **Write summary** saves the Markdown file in the workspace's `meetings/` folder. **Open summary** launches the latest saved summary in the system's default Markdown editor.

The current local output engine is Chatterbox with the Appatalks reference voice. The display label is persisted as an output profile; changing the actual reference audio requires restarting the local voice bridge with the authorized WAV.

The installed `chatterbox-tts` engine is the original English Chatterbox model. Upstream recommends its default `exaggeration=0.5` and `cfg_weight=0.5` for general speech, and approximately `exaggeration=0.7` with `cfg_weight=0.3` for more expressive but deliberate speech. Appatalks defaults to `0.65` and `0.35`; both values are editable per voice profile in Settings and are sent with every synthesis request. Natural contractions, punctuation, brief pauses, and varied sentence rhythm are also encouraged through the Appatalks voice instructions. Chatterbox Turbo supports tags such as `[laugh]` and `[chuckle]`, but the current original model does not; the app therefore does not insert unsupported paralinguistic tags.

Each voice profile also has editable custom instructions in Settings. The default Appatalks profile identifies the voice as an expert GitHub Reliability Engineer focused on service reliability, incident clarity, practical remediation, and accountable next steps. Voice instructions are included with the selected agent profile and client knowledge for each model response; they do not alter the underlying audio model.

The sticky footer reports the active transcription model, selected reasoning provider/model, voice profile, average measured completion-token speed, and token spend for the current API session. Local Qwen usage is counted with its tokenizer and includes prompt and completion tokens. The displayed speed is completion tokens divided by wall-clock generation time, so a first model load can lower the initial average. The current Copilot ACP bridge does not report usable token counts; Copilot requests therefore show token spend as **unavailable** instead of presenting a false zero. When a session uses both providers, the footer shows measured-token coverage as `measured requests / total requests`.

## Safety boundary

The default mode is `approval`. Remote transcript text can create a draft but cannot produce speech until `POST /v1/drafts/:draftId/authorize` is called. `guarded-autonomous` only speaks when the draft question directly addresses `agent`, `assistant`, or `eva`; a real release should replace this simple heuristic with a local-user wake/hold-to-talk signal from the audio adapter.

`disabled` blocks all drafts. `suggest` creates text only. `autonomous` sends a response to the speech output immediately. Always disclose AI speech to meeting participants and obtain the appropriate consent before capturing or retaining meeting content.

## Model adapters

Set environment variables from [.env.example](.env.example), then start the service.

| Adapter | Configuration | Use |
| --- | --- | --- |
| Simulation | `VOICE_BRIDGE_PROVIDER=simulation` | Default test path; no network or model required. |
| Qwen / local server | `VOICE_BRIDGE_PROVIDER=openai-compatible` and `VOICE_BRIDGE_LOCAL_MODEL=qwen3-8b` | Default local profile: `Qwen/Qwen3-8B`, served by an OpenAI-compatible endpoint such as LM Studio. |
| Copilot ACP | `VOICE_BRIDGE_PROVIDER=copilot-acp` | Talks to EVA's local ACP HTTP bridge, which owns the authenticated Copilot CLI session. |

The local profiles are selected with `VOICE_BRIDGE_LOCAL_MODEL`:

| Key | Model | Why it is included |
| --- | --- | --- |
| `qwen3-8b` | `Qwen/Qwen3-8B` | Default balanced local model. |
| `llama-3.1-8b` | `meta-llama/Llama-3.1-8B-Instruct` | Stable general-conversation fallback. |
| `gemma-3-12b` | `google/gemma-3-12b-it` | Concise assistant alternative. |
| `phi-4-14b` | `microsoft/phi-4` | Reasoning-oriented alternative. |

The machine used to build this release has a 16 GB RTX 5070 Ti. Serve a quantized local model that fits with context and desktop overhead; begin with Qwen3 8B. No model is bundled or downloaded by this service.

## EVA voice bridge

EVA's `tools/local_voices_bridge.py` already exposes `POST /v1/speech` and returns a WAV. Start it with an authorized voice profile, then configure:

```bash
LOCAL_VOICE_BRIDGE_URL=http://127.0.0.1:8090/ npm start
```

Set `VOICE_BRIDGE_AUDIO_OUTPUT=pipewire` as well and approved WAV data is streamed with `pw-cat` into the dedicated `voice_bridge_agent` sink. The conferencing application receives its `voice_bridge_agent.monitor` source as a microphone. The physical microphone is looped into the same sink, so your voice and authorized agent output are combined without recording arbitrary desktop audio.

## PipeWire audio bridge

This project now has a Linux PipeWire/PulseAudio-compatible device lifecycle. It was live-smoke-tested on the local machine by creating both virtual sinks, sending a generated WAV into the agent sink, confirming the monitor source was active, and removing every created module.

```bash
npm run audio:dry-run
bash tools/audio-bridge.sh start
bash tools/audio-bridge.sh status
```

Then, in Teams, Zoom, or a desktop softphone, select:

| Client setting | Device |
| --- | --- |
| Speaker/output | `Voice Bridge Conference Capture` (`voice_bridge_conference`) |
| Microphone/input | `voice_bridge_agent.monitor` |

The bridge loops the conference sink to your normal system output, so conference audio remains audible. It captures only `voice_bridge_conference.monitor`, not the entire desktop mix. Stop and remove all created virtual devices with:

```bash
bash tools/audio-bridge.sh stop
```

The HTTP `POST /v1/audio/start` endpoint is intentionally locked until `VOICE_BRIDGE_ENABLE_AUDIO_CONTROL=true` is present. This prevents the browser test dashboard from silently altering the system audio graph.

## Local Whisper capture

The transcription runner uses FFmpeg to capture `voice_bridge_conference.monitor` in four-second, 16 kHz mono WAV segments. A maximum-volume gate ignores silent segments before they reach local `whisper.cpp`; adjust its `-45 dB` threshold with `VOICE_BRIDGE_SILENCE_DB` when needed. Each qualifying segment is sent to `POST /v1/transcripts` as remote speech.

```bash
npm run whisper:bootstrap:dry-run
bash tools/bootstrap-whisper.sh

export WHISPER_BIN="$PWD/vendor/whisper.cpp/build/bin/whisper-cli"
export WHISPER_MODEL="$PWD/vendor/whisper.cpp/models/ggml-base.en.bin"
bash tools/transcribe-stream.sh --check
bash tools/transcribe-stream.sh
```

The bootstrap script tries CUDA when available and automatically falls back to CPU if the local CUDA compiler cannot build the active GPU architecture. Use `WHISPER_CUDA=true` to require CUDA or `WHISPER_CUDA=false` to select CPU deliberately. The runner is deliberately segment-based for the first end-to-end integration: it is inspectable, easy to stop, and does not require a hidden audio driver. Its next evolution should add VAD, partial transcript events, and local/remote speaker separation.

## HTTP test surface

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Provider and voice-output readiness. |
| `GET /v1/models` | Four local profiles and selected default. |
| `GET /v1/state` | In-memory transcript, drafts, and dispatches. |
| `POST /v1/mode` | Set `disabled`, `suggest`, `approval`, `guarded-autonomous`, or `autonomous`. |
| `POST /v1/transcripts` | Add `{ "speaker": "remote", "text": "..." }`. |
| `POST /v1/drafts` | Ask the configured provider `{ "question": "..." }`. |
| `POST /v1/drafts/:draftId/authorize` | Explicitly dispatch an approved draft. |
| `POST /v1/simulation/run` | Deterministic meeting flow without a conferencing client. |
| `POST /v1/stop` | Cancels queued output; production PipeWire playback will also stop active playback. |

## Validation

The automated suite includes policy tests, model simulation tests, and direct Fastify HTTP integration tests. Run it with:

```bash
npm test && npm run typecheck && npm run simulate
```

This is a testing release, not an unattended production deployment. Before a real meeting, add: response cancellation through the TTS bridge, encrypted retention controls, audio-level barge-in, and manual live-call acceptance testing.