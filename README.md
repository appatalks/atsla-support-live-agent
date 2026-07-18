# ATSLA | Support Live Agent

ATSLA is a local, operator-controlled AI support agent for live customer conversations. It listens to call audio, prepares or speaks concise support responses through a local voice profile, and gives the operator clear control over every session, client workspace, and intervention.

It is designed for conversations in Microsoft Teams, Zoom, Slack, browser calls, and other communication tools that can use standard system audio devices. The agent runs locally: transcription, reasoning, session control, and voice output remain on the operator's machine.

## What It Does

- Keeps a distinct session history for each client workspace.
- Requires an explicit client context load before client files enter a prompt.
- Sends the Standard Greeting automatically whenever a new session begins.
- Supports monitor, approval, and autonomous response modes.
- Routes generated voice to a dedicated virtual microphone, separate from the operator microphone.
- Lets the operator hear both the caller and generated agent audio locally.
- Offers local Qwen and authenticated GitHub Copilot CLI reasoning options.
- Uses a local AppaTalks voice profile with adjustable expression and pacing.
- Detects live-representative requests and provides immediate operator takeover controls.

## Operator Workflow

1. Start ATSLA and join the live call.
2. Select or create the client workspace.
3. Load that client's context when it is appropriate for the conversation.
4. Start a session. ATSLA sends the Standard Greeting and records the session only under that client workspace.
5. Choose how the agent participates: monitor, approve responses, or allow autonomous responses.
6. Use operator takeover whenever a person should resume the conversation.

ATSLA deliberately keeps client knowledge, meeting records, learned observations, and sessions separated. Switching client workspaces clears live conversation state and displays only that client's sessions.

## Quick Start

Prerequisites: Linux with PipeWire/PulseAudio for live virtual audio routing, Node.js, Python, a local voice reference, and optional local Qwen or authenticated GitHub Copilot CLI access.

```bash
npm install
npm test
npm run typecheck
npm run app:start
```

The Electron operator console opens automatically. To stop all supervised services and remove virtual audio devices:

```bash
npm run app:stop
```

For simulated development without live call routing:

```bash
npm run simulate
npm start
```

## Privacy And Safety

ATSLA is an operator tool, not an unattended participant. Inform participants that an AI agent is present and obtain the required consent before capturing or retaining meeting material.

Client context is opt-in. The application owns the context boundary: Copilot is launched without memory, continuation, custom instructions, built-in MCPs, or durable request logs; every Copilot completion receives a fresh ACP session. Client data must not be placed in the global shared knowledge folder.

## Documentation

Detailed installation, audio routing, configuration, architecture, environment variables, API routes, and validation steps are in [README-2.md](README-2.md).

## Project Status

ATSLA is an actively developed local support-agent project. Test carefully in a controlled call before using it in a customer-facing workflow. Review your organization's privacy, retention, accessibility, and disclosure requirements before deployment.