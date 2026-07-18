import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MeetingCoordinator } from "../src/coordinator.js";
import { DraftStore, ResponsePolicy } from "../src/policy.js";
import { SessionStore } from "../src/session-store.js";
import { SimulationProvider } from "../src/providers.js";
import { SimulatedSpeechOutput } from "../src/voice.js";
import { ClientWorkspace } from "../src/settings.js";

describe("persistent meeting sessions", () => {
  it("greets once, persists conversation state, and restores a selected session", async () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-sessions-"));
    try {
      const sessions = new SessionStore(root);
      const workspace = new ClientWorkspace(join(root, "clients"));
      const coordinator = new MeetingCoordinator(
        new SimulationProvider(),
        new ResponsePolicy("autonomous"),
        new DraftStore(),
        new SimulatedSpeechOutput(),
        undefined,
        workspace,
        sessions,
      );

      const clientWorkspace = join(root, "clients", "northwind");
      coordinator.updateSettings({ clientWorkspace });
      const first = await coordinator.createSession({ title: "Northwind kickoff" });
      expect(first.greetingSent).toBe(true);
      expect(coordinator.state().drafts.filter((draft) => draft.question === "Operator template")).toHaveLength(1);
      await coordinator.ingest({ id: "remote-1", speaker: "remote", text: "We need to review reliability.", occurredAt: new Date().toISOString() });
      const second = await coordinator.createSession({ title: "Contoso follow-up" });
      expect(second.greetingSent).toBe(true);

      const restored = coordinator.selectSession(first.id);
      expect(restored.title).toBe("Northwind kickoff");
      expect(coordinator.state().transcript[0].text).toContain("review reliability");
      expect(coordinator.listSessions()).toHaveLength(2);
      expect(coordinator.state().drafts.filter((draft) => draft.question === "Operator template")).toHaveLength(1);

      const renamed = coordinator.renameSession(first.id, "Northwind reliability review");
      expect(renamed.title).toBe("Northwind reliability review");
      expect(sessions.get(first.id).title).toBe("Northwind reliability review");
      expect(coordinator.listSessions().find((session) => session.id === first.id)?.title).toBe("Northwind reliability review");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps each client workspace's sessions separate", async () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-workspace-sessions-"));
    try {
      const sessions = new SessionStore(root);
      const workspace = new ClientWorkspace(join(root, "clients"));
      const coordinator = new MeetingCoordinator(
        new SimulationProvider(),
        new ResponsePolicy("autonomous"),
        new DraftStore(),
        new SimulatedSpeechOutput(),
        undefined,
        workspace,
        sessions,
      );
      coordinator.updateSettings({ clientWorkspace: join(root, "clients", "northwind") });
      const northwind = await coordinator.createSession({ title: "Northwind review" });
      expect(coordinator.listSessions()).toMatchObject([{ id: northwind.id }]);

      coordinator.selectClientWorkspace({ path: join(root, "clients", "contoso") });
      expect(coordinator.listSessions()).toEqual([]);
      const contoso = await coordinator.createSession({ title: "Contoso review" });
      expect(coordinator.listSessions()).toMatchObject([{ id: contoso.id }]);
      expect(() => coordinator.selectSession(northwind.id)).toThrow("different client workspace");
      expect(() => coordinator.renameSession(northwind.id, "Cross-client rename")).toThrow("different client workspace");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
