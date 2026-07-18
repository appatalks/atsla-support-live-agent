import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClientWorkspace, SettingsStore, defaultSettings } from "../src/settings.js";

describe("client workspace", () => {
  const folders: string[] = [];

  afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

  it("creates a client knowledge, bulk-context, guardrail, skills, and meeting-log structure", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-client-"));
    folders.push(root);
    const workspace = new ClientWorkspace(root);
    const folder = workspace.select({ name: "Northwind Support" });

    expect(existsSync(join(folder, "client-profile.json"))).toBe(true);
    expect(existsSync(join(folder, "knowledge", "README.md"))).toBe(true);
    expect(existsSync(join(folder, "skills", "README.md"))).toBe(true);
    expect(existsSync(join(folder, "context-drop", "README.md"))).toBe(true);
    expect(existsSync(join(folder, "context-drop", "CONTEXT-GUARDRAILS.md"))).toBe(true);
    expect(existsSync(join(folder, "meetings"))).toBe(true);
    const global = workspace.prepareGlobalKnowledge(join(root, "global"));
    expect(existsSync(join(global, "GLOBAL-GUARDRAILS.md"))).toBe(true);

    workspace.appendTranscript(folder, "- Remote: The client needs help.");
    const profile = JSON.parse(readFileSync(join(folder, "client-profile.json"), "utf8"));
    expect(profile.transcriptEvents).toBe(1);
    expect(profile.lastConversationAt).toBeTruthy();

    const summaryPath = workspace.appendSummary(folder, "The team agreed on the next step.");
    expect(summaryPath).toBe(join(folder, "meetings", `${new Date().toISOString().slice(0, 10)}.summary.md`));
    expect(workspace.latestSummary(folder)).toBe(summaryPath);
  });

  it("adds bulk-context guardrails to an existing client workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-existing-client-"));
    folders.push(root);
    const folder = join(root, "Existing Client");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "client-profile.json"), JSON.stringify({ name: "Existing Client" }), "utf8");
    const workspace = new ClientWorkspace(root);

    workspace.select({ path: folder });

    expect(existsSync(join(folder, "context-drop", "README.md"))).toBe(true);
    expect(readFileSync(join(folder, "context-drop", "CONTEXT-GUARDRAILS.md"), "utf8")).toContain("Sensitive Or Restricted");
  });
});

describe("default voice profile", () => {
  it("defines AppaTalks as an expert GitHub Reliability Engineer", () => {
    const defaults = defaultSettings();
    const appaTalks = defaults.voiceProfiles.find((profile) => profile.name === "AppaTalks");
    expect(appaTalks?.instructions).toContain("AppaTalks, an expert GitHub Reliability Engineer");
    expect(appaTalks?.instructions).toContain("ATSLA means AppaTalks Support Live Agent");
    expect(appaTalks).toMatchObject({ exaggeration: 0.65, cfgWeight: 0.35 });
    expect(defaults.voiceProfile).toBe("AppaTalks");
    expect(defaults.responseMode).toBe("autonomous");
    expect(defaults.defaultInputMode).toBe("agent");
  });

  it("persists edited AppaTalks custom instructions", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-settings-"));
    try {
      const path = join(root, "settings.json");
      const store = new SettingsStore(path);
      const voiceProfiles = store.get().voiceProfiles.map((profile) => ({ ...profile, instructions: "Custom reliability instruction." }));
      store.update({ voiceProfiles });

      expect(new SettingsStore(path).get().voiceProfiles[0].instructions).toBe("Custom reliability instruction.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates pre-v5 settings to autonomous mode and the agent microphone", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-migration-"));
    try {
      const path = join(root, "settings.json");
      const legacy = { ...defaultSettings(), settingsVersion: 2, responseMode: "approval", defaultInputMode: "operator" };
      writeFileSync(path, JSON.stringify(legacy), "utf8");
      const migrated = new SettingsStore(path).get();

      expect(migrated.settingsVersion).toBe(8);
      expect(migrated.responseMode).toBe("autonomous");
      expect(migrated.defaultInputMode).toBe("agent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates existing Atsla and Appatalks settings to AppaTalks", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-appatalks-migration-"));
    try {
      const path = join(root, "settings.json");
      const legacy = {
        ...defaultSettings(),
        settingsVersion: 6,
        voiceProfile: "Atsla",
        voiceProfiles: [{ id: "appatalks", name: "Appatalks", instructions: "Custom Appatalks instruction.", exaggeration: 0.65, cfgWeight: 0.35 }],
      };
      writeFileSync(path, JSON.stringify(legacy), "utf8");
      const migrated = new SettingsStore(path).get();

      expect(migrated.voiceProfile).toBe("AppaTalks");
      expect(migrated.voiceProfiles[0]).toMatchObject({ id: "appatalks", name: "AppaTalks" });
      expect(migrated.voiceProfiles[0].instructions).toContain("AppaTalks");
      const persisted = JSON.parse(readFileSync(path, "utf8"));
      expect(persisted.voiceProfile).toBe("AppaTalks");
      expect(persisted.voiceProfiles[0]).toMatchObject({ id: "appatalks", name: "AppaTalks" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists a selectable theme and clamps glass transparency", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-appearance-"));
    try {
      const path = join(root, "settings.json");
      const store = new SettingsStore(path);
      expect(store.get()).toMatchObject({ appearanceTheme: "atelier", glassTransparency: 88 });

      store.update({ appearanceTheme: "lcars", glassTransparency: 120 });
      expect(new SettingsStore(path).get()).toMatchObject({ appearanceTheme: "lcars", glassTransparency: 100 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});