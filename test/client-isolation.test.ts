import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MeetingCoordinator } from "../src/coordinator.js";
import { DraftStore, ResponsePolicy } from "../src/policy.js";
import { ClientWorkspace, SettingsStore } from "../src/settings.js";
import { SimulatedSpeechOutput } from "../src/voice.js";
import { type ChatRequest, type ModelReply } from "../src/domain.js";
import { SessionStore } from "../src/session-store.js";

describe("client knowledge isolation", () => {
  it("loads only the explicit client, keeps global knowledge separate, and stores observations in that client", async () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-isolation-"));
    try {
      const clientsRoot = join(root, "clients");
      const globalRoot = join(root, "global-knowledge");
      mkdirSync(globalRoot, { recursive: true });
      writeFileSync(join(globalRoot, "shared.md"), "GLOBAL_SHARED_RUNBOOK", "utf8");
      const settingsStore = new SettingsStore(join(root, "settings.json"));
      settingsStore.update({ globalKnowledgePath: globalRoot, globalKnowledgeEnabled: true, retainSessionLearnings: true });
      const workspace = new ClientWorkspace(clientsRoot);
      const prompts: string[] = [];
      const provider = {
        id: "local-qwen" as const,
        complete: async (request: ChatRequest): Promise<ModelReply> => {
          prompts.push(request.question);
          return { text: "Acknowledged.", provider: "local-qwen", model: "test" };
        },
      };
      const coordinator = new MeetingCoordinator(provider, new ResponsePolicy("approval"), new DraftStore(), new SimulatedSpeechOutput(), settingsStore, workspace, new SessionStore(join(root, "sessions")));

      const clientA = coordinator.selectClientWorkspace({ name: "Client A" }).clientWorkspace;
      writeFileSync(join(clientA, "knowledge", "private.md"), "CLIENT_A_PRIVATE", "utf8");
      writeFileSync(join(clientA, "meetings", "old.transcript.md"), "MEETING_LOG_MUST_NOT_LOAD", "utf8");
      const sessionA = await coordinator.createSession({ title: "Client A review" });
      coordinator.loadClientContext();
      await coordinator.ingest({ id: "a1", speaker: "remote", text: "Client A uses region east.", occurredAt: new Date().toISOString() });
      await coordinator.respondToConversation("What context is active?");
      expect(prompts.at(-1)).toContain("CLIENT_A_PRIVATE");
      expect(prompts.at(-1)).toContain("GLOBAL_SHARED_RUNBOOK");
      expect(prompts.at(-1)).not.toContain("MEETING_LOG_MUST_NOT_LOAD");
      const learningPath = join(clientA, "learnings", `${sessionA.id}.observations.md`);
      expect(existsSync(learningPath)).toBe(true);
      expect(readFileSync(learningPath, "utf8")).toContain("Client A uses region east");

      const clientB = coordinator.selectClientWorkspace({ name: "Client B" }).clientWorkspace;
      writeFileSync(join(clientB, "knowledge", "private.md"), "CLIENT_B_PRIVATE", "utf8");
      expect(coordinator.state().transcript).toHaveLength(0);
      expect(coordinator.contextStatus().client.loaded).toBe(false);
      await coordinator.respondToConversation("What context is active now?");
      expect(prompts.at(-1)).toContain("GLOBAL_SHARED_RUNBOOK");
      expect(prompts.at(-1)).not.toContain("CLIENT_A_PRIVATE");
      expect(prompts.at(-1)).not.toContain("CLIENT_B_PRIVATE");

      coordinator.loadClientContext();
      await coordinator.respondToConversation("Use the loaded client context.");
      expect(prompts.at(-1)).toContain("CLIENT_B_PRIVATE");
      expect(prompts.at(-1)).not.toContain("CLIENT_A_PRIVATE");
      expect(existsSync(join(clientB, "learnings", "unsessioned.observations.md"))).toBe(false);

      coordinator.clearClientContext();
      expect(coordinator.contextStatus().client.loaded).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects overlapping client and global knowledge roots", () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-overlap-"));
    try {
      const settingsStore = new SettingsStore(join(root, "settings.json"));
      settingsStore.update({ globalKnowledgePath: root });
      const coordinator = new MeetingCoordinator(
        { id: "local-qwen", complete: async () => ({ text: "ok", provider: "local-qwen", model: "test" }) },
        new ResponsePolicy("approval"),
        new DraftStore(),
        new SimulatedSpeechOutput(),
        settingsStore,
        new ClientWorkspace(join(root, "clients")),
      );
      expect(() => coordinator.selectClientWorkspace({ name: "Client A" })).toThrow(/separate, non-overlapping/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
