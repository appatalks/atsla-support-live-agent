import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { type ResponseMode } from "./domain.js";

export interface AgentProfile {
  id: string;
  name: string;
  tone: string;
  voiceStyle: string;
  instructions: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  instructions: string;
  exaggeration: number;
  cfgWeight: number;
}

export interface VoiceBridgeSettings {
  settingsVersion: number;
  responseMode: ResponseMode;
  defaultInputMode: "operator" | "agent";
  modelProvider: "local-qwen" | "copilot-acp";
  inputModel: string;
  copilotModel: string;
  voiceProfile: string;
  voiceProfiles: VoiceProfile[];
  activeProfileId: string;
  clientWorkspace: string;
  saveMeetingLog: boolean;
  summarizeMeeting: boolean;
  autonomyDelayMs: number;
  profiles: AgentProfile[];
  recentClientWorkspaces: string[];
}

const defaultProfiles: AgentProfile[] = [
  { id: "support", name: "Support Partner", tone: "calm and practical", voiceStyle: "clear and warm", instructions: "Prioritize accurate troubleshooting, next steps, and concise summaries." },
  { id: "technical", name: "Technical Specialist", tone: "precise and direct", voiceStyle: "measured and confident", instructions: "Explain technical tradeoffs plainly, identify assumptions, and avoid unsupported certainty." },
  { id: "concierge", name: "Client Concierge", tone: "warm and collaborative", voiceStyle: "friendly and polished", instructions: "Keep the conversation constructive, organized, and focused on the client outcome." },
];

const defaultVoiceProfiles: VoiceProfile[] = [
  {
    id: "appatalks",
    name: "Appatalks",
    instructions: "You are an expert GitHub Reliability Engineer. Speak with calm operational authority, prioritize service reliability, incident clarity, practical remediation, and accountable next steps. Use natural contractions, brief thoughtful pauses, varied sentence rhythm, and warm human phrasing without narrating internal reasoning.",
    exaggeration: 0.65,
    cfgWeight: 0.35,
  },
];

export function defaultSettings(): VoiceBridgeSettings {
  return {
    settingsVersion: 4,
    responseMode: "autonomous",
    defaultInputMode: "agent",
    modelProvider: "local-qwen",
    inputModel: "qwen3-8b",
    copilotModel: "auto",
    voiceProfile: "Appatalks",
    voiceProfiles: defaultVoiceProfiles,
    activeProfileId: "support",
    clientWorkspace: "",
    saveMeetingLog: false,
    summarizeMeeting: true,
    autonomyDelayMs: 4_500,
    profiles: defaultProfiles,
    recentClientWorkspaces: [],
  };
}

export class SettingsStore {
  private value: VoiceBridgeSettings;

  constructor(private readonly settingsPath = process.env.VOICE_BRIDGE_SETTINGS_PATH ?? join(homedir(), ".config", "voice-bridge", "settings.json")) {
    this.value = this.load();
  }

  get(): VoiceBridgeSettings {
    return structuredClone(this.value);
  }

  update(partial: Partial<VoiceBridgeSettings>): VoiceBridgeSettings {
    const profiles = Array.isArray(partial.profiles) && partial.profiles.length ? partial.profiles.map(normalizeProfile) : this.value.profiles;
    const voiceProfiles = Array.isArray(partial.voiceProfiles) && partial.voiceProfiles.length ? partial.voiceProfiles.map(normalizeVoiceProfile) : this.value.voiceProfiles;
    const responseMode = isResponseMode(partial.responseMode) ? partial.responseMode : this.value.responseMode;
    const defaultInputMode = partial.defaultInputMode === "operator" ? "operator" : partial.defaultInputMode === "agent" ? "agent" : this.value.defaultInputMode;
    const inputModel = typeof partial.inputModel === "string" ? partial.inputModel : this.value.inputModel;
    const modelProvider = partial.modelProvider === "copilot-acp" ? "copilot-acp" : partial.modelProvider === "local-qwen" ? "local-qwen" : this.value.modelProvider;
    const activeProfileId = profiles.some((profile) => profile.id === partial.activeProfileId) ? partial.activeProfileId! : this.value.activeProfileId;
    this.value = {
      ...this.value,
      ...partial,
      responseMode,
      defaultInputMode,
      modelProvider,
      inputModel,
      activeProfileId,
      profiles,
      voiceProfiles,
      recentClientWorkspaces: Array.isArray(partial.recentClientWorkspaces) ? partial.recentClientWorkspaces.filter((folder) => typeof folder === "string").slice(0, 12) : this.value.recentClientWorkspaces,
      autonomyDelayMs: clampDelay(partial.autonomyDelayMs ?? this.value.autonomyDelayMs),
    };
    this.persist();
    return this.get();
  }

  private load(): VoiceBridgeSettings {
    try {
      const stored = JSON.parse(readFileSync(this.settingsPath, "utf8")) as Partial<VoiceBridgeSettings>;
      const isLegacy = stored.settingsVersion !== 4;
      const migrated = isLegacy ? { ...stored, settingsVersion: 4, responseMode: "autonomous" as const, defaultInputMode: "agent" as const } : stored;
      const migratedVoiceProfiles = migrated.voiceProfiles?.length ? migrated.voiceProfiles.map(normalizeVoiceProfile) : defaultVoiceProfiles;
      for (const profile of migratedVoiceProfiles) {
        if (isLegacy && profile.id === "appatalks" && !profile.instructions.includes("natural contractions")) {
          profile.instructions += " Use natural contractions, brief thoughtful pauses, varied sentence rhythm, and warm human phrasing without narrating internal reasoning.";
        }
      }
      return {
        ...defaultSettings(),
        ...migrated,
        profiles: migrated.profiles?.length ? migrated.profiles.map(normalizeProfile) : defaultProfiles,
        voiceProfiles: migratedVoiceProfiles,
      };
    } catch {
      return defaultSettings();
    }
  }

  private persist(): void {
    mkdirSync(resolve(this.settingsPath, ".."), { recursive: true });
    writeFileSync(this.settingsPath, `${JSON.stringify(this.value, null, 2)}\n`, "utf8");
  }
}

export class ClientWorkspace {
  constructor(private readonly defaultRoot = process.env.VOICE_BRIDGE_CLIENTS_ROOT ?? join(homedir(), "Documents", "Voice Bridge Clients")) {}

  select(request: { path?: string; name?: string }): string {
    const folder = request.path?.trim() ? resolve(request.path) : join(this.defaultRoot, safeName(request.name ?? "New Client"));
    mkdirSync(folder, { recursive: true });
    mkdirSync(join(folder, "knowledge"), { recursive: true });
    mkdirSync(join(folder, "skills"), { recursive: true });
    mkdirSync(join(folder, "meetings"), { recursive: true });
    const profilePath = join(folder, "client-profile.json");
    if (!existsSync(profilePath)) {
      writeFileSync(profilePath, `${JSON.stringify({ name: request.name?.trim() || basename(folder), createdAt: new Date().toISOString(), notes: "" }, null, 2)}\n`, "utf8");
      writeFileSync(join(folder, "knowledge", "README.md"), "# Client Knowledge\n\nAdd product notes, runbooks, and account context here.\n", "utf8");
      writeFileSync(join(folder, "skills", "README.md"), "# Agent Skills\n\nAdd client-specific procedures and escalation rules here.\n", "utf8");
    }
    return folder;
  }

  context(folder: string): string {
    if (!folder || !existsSync(folder)) return "";
    const files = walk(folder).filter((file) => [".md", ".txt", ".json"].includes(extname(file).toLowerCase()) && !file.includes(`${join(folder, "meetings")}/`));
    let result = "";
    for (const file of files) {
      if (result.length >= 16_000) break;
      try {
        const content = readFileSync(file, "utf8").trim();
        if (!content) continue;
        result += `\n[${relative(folder, file)}]\n${content.slice(0, 4_000)}\n`;
      } catch {}
    }
    return result.trim();
  }

  appendTranscript(folder: string, line: string): void {
    if (!folder) return;
    this.select({ path: folder });
    appendFileSync(join(folder, "meetings", `${dateKey()}.transcript.md`), `${line}\n`, "utf8");
    this.updateProfile(folder, { lastConversationAt: new Date().toISOString(), transcriptEvents: 1 });
  }

  appendSummary(folder: string, summary: string): string {
    if (!folder) return "";
    this.select({ path: folder });
    const summaryPath = join(folder, "meetings", `${dateKey()}.summary.md`);
    appendFileSync(summaryPath, `\n## ${new Date().toLocaleString()}\n${summary}\n`, "utf8");
    this.updateProfile(folder, { lastSummaryAt: new Date().toISOString() });
    return summaryPath;
  }

  latestSummary(folder: string): string {
    if (!folder || !existsSync(join(folder, "meetings"))) return "";
    return readdirSync(join(folder, "meetings"))
      .filter((name) => name.endsWith(".summary.md"))
      .sort()
      .reverse()
      .map((name) => join(folder, "meetings", name))[0] ?? "";
  }

  private updateProfile(folder: string, changes: Record<string, string | number>): void {
    const profilePath = join(folder, "client-profile.json");
    try {
      const profile = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, unknown>;
      profile.lastConversationAt = changes.lastConversationAt ?? profile.lastConversationAt;
      profile.lastSummaryAt = changes.lastSummaryAt ?? profile.lastSummaryAt;
      if (typeof changes.transcriptEvents === "number") profile.transcriptEvents = Number(profile.transcriptEvents ?? 0) + changes.transcriptEvents;
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    } catch {}
  }
}

function normalizeProfile(profile: AgentProfile): AgentProfile {
  return { id: safeName(profile.id || profile.name || "profile"), name: profile.name.slice(0, 80), tone: profile.tone.slice(0, 240), voiceStyle: profile.voiceStyle.slice(0, 240), instructions: profile.instructions.slice(0, 4_000) };
}

function normalizeVoiceProfile(profile: VoiceProfile): VoiceProfile {
  return {
    id: safeName(profile.id || profile.name || "voice"),
    name: profile.name.slice(0, 80),
    instructions: profile.instructions.slice(0, 4_000),
    exaggeration: clampVoiceNumber(profile.exaggeration, 0.65),
    cfgWeight: clampVoiceNumber(profile.cfgWeight, 0.35),
  };
}

function clampVoiceNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "client";
}

function clampDelay(value: number): number {
  return Number.isFinite(value) ? Math.max(1_500, Math.min(20_000, Math.round(value))) : 4_500;
}

function isResponseMode(value: unknown): value is ResponseMode {
  return value === "disabled" || value === "suggest" || value === "approval" || value === "guarded-autonomous" || value === "autonomous";
}

function walk(folder: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(folder)) {
    if (entry.startsWith(".")) continue;
    const file = join(folder, entry);
    try {
      if (statSync(file).isDirectory()) files.push(...walk(file));
      else files.push(file);
    } catch {}
  }
  return files;
}

function dateKey(): string {
  return new Date().toISOString().slice(0, 10);
}