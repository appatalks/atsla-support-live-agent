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
    process.env.VOICE_BRIDGE_CLIENTS_ROOT = join(testRoot, "clients");
    process.env.VOICE_BRIDGE_GLOBAL_KNOWLEDGE_PATH = join(testRoot, "global");
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    delete process.env.VOICE_BRIDGE_SETTINGS_PATH;
    delete process.env.VOICE_BRIDGE_SESSIONS_PATH;
    delete process.env.VOICE_BRIDGE_CLIENTS_ROOT;
    delete process.env.VOICE_BRIDGE_GLOBAL_KNOWLEDGE_PATH;
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
    expect(dashboard.body).toContain("ATSLA | Support Live Agent");
    expect(dashboard.body).toContain("AppaTalks");
    expect(dashboard.body).toContain("Open folder");
    expect(dashboard.body).toContain("context-drop");
    expect(dashboard.body).toContain("data-settings-tab=\"workspace\"");
    expect(dashboard.body).toContain("data-settings-tab=\"agent\"");
    expect(dashboard.body).toContain("data-settings-tab=\"voice\"");
    expect(dashboard.body).toContain("data-settings-tab=\"appearance\"");
    expect(dashboard.body).toContain("appearanceTheme");
    expect(dashboard.body).toContain("ATSLA signal");
    expect(dashboard.body).toContain("theme-atsla");
    expect(dashboard.body).toContain("glassTransparency");
    expect(dashboard.body).toContain("theme-lcars");
    expect(dashboard.body).toContain("theme-terminal");
    expect(dashboard.body).toContain("theme-dark");
    expect(dashboard.body).toContain("input-mode.active");
    expect(dashboard.body).toContain("Live representative requested");
    expect(dashboard.body).toContain("Take over");
    expect(dashboard.body).toContain('id="directText"');
    expect(dashboard.body).toContain("Speak direct text");
    expect(dashboard.body).toContain("/v1/templates/speak");
    expect(dashboard.body).not.toContain('id="wire"');
    expect(dashboard.body).toContain("height:calc(100vh - 44px)");
    expect(dashboard.body).not.toContain("window-drag-strip");
    expect(dashboard.body).toContain("event.target===byId('settingsOverlay')");
    expect(dashboard.body).toContain(".timeline{min-height:0;overflow-y:auto");
    expect(dashboard.body).toContain("session-rename-input");
    expect(dashboard.body).not.toContain("window.prompt('Rename session'");
    expect(dashboard.body).toContain("Writing meeting summary...");
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

  it("renames a persisted session and rejects blank titles", async () => {
    const server = buildServer();
    servers.push(server);
    await server.inject({ method: "POST", url: "/v1/client-workspace", payload: { name: "Session Client" } });
    const created = (await server.inject({ method: "POST", url: "/v1/sessions", payload: { title: "Original" } })).json().session;

    const renamed = await server.inject({ method: "PATCH", url: `/v1/sessions/${created.id}`, payload: { title: "Renamed session" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().session.title).toBe("Renamed session");
    expect((await server.inject({ method: "GET", url: "/v1/sessions" })).json().sessions[0].title).toBe("Renamed session");

    const blank = await server.inject({ method: "PATCH", url: `/v1/sessions/${created.id}`, payload: { title: "   " } });
    expect(blank.statusCode).toBe(400);
  });

  it("explicitly loads and clears only the selected client context", async () => {
    const server = buildServer();
    servers.push(server);
    const selected = (await server.inject({ method: "POST", url: "/v1/client-workspace", payload: { name: "Context Client" } })).json();
    expect(selected.clientWorkspace).toContain("Context-Client");
    expect((await server.inject({ method: "GET", url: "/v1/context/status" })).json().client.loaded).toBe(false);

    const loaded = await server.inject({ method: "POST", url: "/v1/context/load" });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toMatchObject({ loaded: true, path: selected.clientWorkspace });

    const cleared = await server.inject({ method: "POST", url: "/v1/context/clear" });
    expect(cleared.json()).toMatchObject({ loaded: false, path: "", files: 0 });
  });
});