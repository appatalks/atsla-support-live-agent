import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("installation entry points", () => {
  it("provides a curl bootstrap and a durable atsla launcher", () => {
    const bootstrap = readFileSync(`${root}/get-atsla.sh`, "utf8");
    const installer = readFileSync(`${root}/tools/install.sh`, "utf8");

    expect(bootstrap).toContain("https://github.com/appatalks/atsla-support-live-agent.git");
    expect(bootstrap).toContain('exec bash "$INSTALL_DIR/tools/install.sh"');
    expect(installer).toContain('local launcher="$bin_dir/atsla"');
    expect(installer).toContain('Usage: atsla [start|stop|status|update|path]');
    expect(installer).toContain('[[ "$INSTALL_VOICE" == "true" ]] || return 0');
    expect(installer).toContain('node "$electron_dir/install.js"');
    expect(installer).toContain('npm install --include=dev');
  });

  it("starts ATSLA's independent stateless Copilot ACP bridge", () => {
    const supervisor = readFileSync(`${root}/tools/voice-bridge.sh`, "utf8");
    const bridge = readFileSync(`${root}/tools/stateless_acp_bridge.py`, "utf8");
    expect(supervisor).toContain('python3 "$ROOT_DIR/tools/stateless_acp_bridge.py"');
    expect(supervisor).not.toContain("EVA_ACP_BRIDGE_SCRIPT");
    expect(bridge).toContain('"session/new"');
    expect(bridge).toContain('"session/prompt"');
    expect(bridge).not.toContain("eva-agent");
  });
});