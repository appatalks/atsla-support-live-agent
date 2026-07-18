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

  it("loads an optional persistent configuration file for the Copilot ACP bridge", () => {
    const supervisor = readFileSync(`${root}/tools/voice-bridge.sh`, "utf8");
    expect(supervisor).toContain('ENV_FILE="${VOICE_BRIDGE_ENV_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/voice-bridge/env}"');
    expect(supervisor).toContain('source "$ENV_FILE"');
    expect(supervisor).toContain("EVA_ACP_BRIDGE_SCRIPT");
  });
});