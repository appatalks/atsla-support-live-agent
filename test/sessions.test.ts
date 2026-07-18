import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MeetingCoordinator } from "../src/coordinator.js";
import { DraftStore, ResponsePolicy } from "../src/policy.js";
import { SessionStore } from "../src/session-store.js";
import { SimulationProvider } from "../src/providers.js";
import { SimulatedSpeechOutput } from "../src/voice.js";

describe("persistent meeting sessions", () => {
  it("greets once, persists conversation state, and restores a selected session", async () => {
    const root = mkdtempSync(join(tmpdir(), "voice-bridge-sessions-"));
    try {
      const sessions = new SessionStore(root);
      const coordinator = new MeetingCoordinator(
        new SimulationProvider(),
        new ResponsePolicy("autonomous"),
        new DraftStore(),
        new SimulatedSpeechOutput(),
        undefined,
        undefined,
        sessions,
      );

      const first = await coordinator.createSession({ title: "Northwind kickoff", sendGreeting: true });
      expect(first.greetingSent).toBe(true);
      expect(coordinator.state().drafts.filter((draft) => draft.question === "Operator template")).toHaveLength(1);
      await coordinator.ingest({ id: "remote-1", speaker: "remote", text: "We need to review reliability.", occurredAt: new Date().toISOString() });
      const second = await coordinator.createSession({ title: "Contoso follow-up", sendGreeting: false });
      expect(second.greetingSent).toBe(false);

      const restored = coordinator.selectSession(first.id);
      expect(restored.title).toBe("Northwind kickoff");
      expect(coordinator.state().transcript[0].text).toContain("review reliability");
      expect(coordinator.listSessions()).toHaveLength(2);
      expect(coordinator.state().drafts.filter((draft) => draft.question === "Operator template")).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
