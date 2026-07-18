#!/usr/bin/env python3
"""Run EVA's ACP transport without EVA/Copilot conversation memory."""

import os
from pathlib import Path
import sys
import threading


def eva_tools_dir() -> Path:
    configured = os.environ.get("EVA_ACP_TOOLS_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2] / "eva-agent" / "tools"


tools_dir = eva_tools_dir()
if not (tools_dir / "bridge" / "core.py").is_file():
    raise RuntimeError(f"EVA ACP bridge package was not found at {tools_dir}")
sys.path.insert(0, str(tools_dir))

from bridge import core, state  # noqa: E402
from bridge.acp_client import ACPClient  # noqa: E402

_original_prompt = ACPClient.prompt


def stateless_prompt(self, text, timeout=120):
    """Create a clean ACP conversation before every app-supplied prompt."""
    if not hasattr(self, "_voice_bridge_prompt_lock"):
        self._voice_bridge_prompt_lock = threading.Lock()
    with self._voice_bridge_prompt_lock:
        session = self._send_request(
            "session/new",
            {"cwd": self.cwd, "mcpServers": []},
            timeout=30,
        )
        if not session or "sessionId" not in session:
            return {"error": "Copilot did not create an isolated ACP session"}
        self.session_id = session["sessionId"]
        print(f"[Voice Bridge] Isolated ACP session created: {self.session_id}", flush=True)
        return _original_prompt(self, text, timeout=timeout)


ACPClient.prompt = stateless_prompt
state.cognition_enabled = False
state.bg_loop_enabled = False
state.memory_backend = "disabled"
core._resolve_memory_backend = lambda: "disabled"
core._build_memory_context = lambda _message: ""
core._post_response_reflection = lambda *_args, **_kwargs: None

if __name__ == "__main__":
    core.main()
