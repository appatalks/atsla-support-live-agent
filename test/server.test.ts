import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("HTTP control plane", () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  let testRoot = "";

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "voice-bridge-server-test-"));
    process.env.VOICE_BRIDGE_SETTINGS_PATH = join(testRoot, "settings.json");
    process.env.VOICE_BRIDGE_SESSIONS_PATH = join(testRoot, "sessions");
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    delete process.env.VOICE_BRIDGE_SETTINGS_PATH;
    delete process.env.VOICE_BRIDGE_SESSIONS_PATH;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("runs a draft through explicit authorization", async () => {
    const server = buildServer();
    servers.push(server);

    expect((await server.inject({ method: "GET", url: "/health" })).json()).toMatchObject({ ok: true, simulation: true });
    expect((await server.inject({ method: "POST", url: "/v1/mode", payload: { mode: "approval" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/v1/transcripts", payload: { speaker: "remote", text: "Can you confirm the next step?" } })).statusCode).toBe(200);
    const draftResponse = await server.inject({ method: "POST", url: "/v1/drafts", payload: { question: "What is the next step?" } });
    const draft = draftResponse.json().draft;
    expect(draft.disposition).toBe("pending-approval");

    const authorization = await server.inject({ method: "POST", url: `/v1/drafts/${draft.id}/authorize` });
    expect(authorization.json().dispatch.status).toBe("spoken");
  });

  it("serves the local simulation dashboard and model profiles", async () => {
    const server = buildServer();
    servers.push(server);

    const dashboard = await server.inject({ method: "GET", url: "/" });
    expect(dashboard.headers["content-type"]).toContain("text/html");
    expect(dashboard.body).toContain("Local Meeting Agent");
    expect(dashboard.body).toContain("input-mode.active");
    expect(dashboard.body).toContain("Live representative requested");
    expect(dashboard.body).toContain("Take over");
    expect(dashboard.body).toContain("html,body{height:100%;overflow:hidden}");
    expect(dashboard.body).toContain(".timeline{min-height:0;overflow-y:auto");
    const script = dashboard.body.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect((await server.inject({ method: "GET", url: "/v1/models" })).json().profiles["qwen3-8b"].model).toBe("Qwen/Qwen3-8B");
  });

  it("reports audio status but refuses device creation unless explicitly enabled", async () => {
    const server = buildServer();
    servers.push(server);

    expect((await server.inject({ method: "GET", url: "/v1/audio/status" })).json()).toHaveProperty("active");
    const start = await server.inject({ method: "POST", url: "/v1/audio/start" });
    expect(start.statusCode).toBe(403);
    expect(start.json().error).toContain("VOICE_BRIDGE_ENABLE_AUDIO_CONTROL=true");
  });

  it("lists Copilot Terra and Luna fallback models", async () => {
    const server = buildServer();
    servers.push(server);
    const options = (await server.inject({ method: "GET", url: "/v1/provider-options" })).json();
    const copilot = options.providers.find((provider: { id: string }) => provider.id === "copilot-acp");
    expect(copilot.models.map((model: { id: string }) => model.id)).toEqual(expect.arrayContaining(["gpt-5.6-terra", "gpt-5.6-luna"]));
  });
});