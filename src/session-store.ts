import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { type MeetingSession, type MeetingSessionSummary } from "./domain.js";

export class SessionStore {
  constructor(private readonly root = process.env.VOICE_BRIDGE_SESSIONS_PATH ?? join(homedir(), ".local", "share", "voice-bridge", "sessions")) {
    mkdirSync(this.root, { recursive: true });
  }

  create(title = "New conversation", clientWorkspace = ""): MeetingSession {
    const now = new Date().toISOString();
    const session: MeetingSession = {
      id: randomUUID(),
      title: title.trim().slice(0, 120) || "New conversation",
      clientWorkspace,
      createdAt: now,
      updatedAt: now,
      greetingSent: false,
      transcript: [],
      drafts: [],
      activity: [],
      escalations: [],
    };
    this.save(session);
    return session;
  }

  save(session: MeetingSession): MeetingSession {
    const stored = { ...session, updatedAt: new Date().toISOString() };
    mkdirSync(this.root, { recursive: true });
    writeFileSync(this.path(stored.id), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    return stored;
  }

  get(id: string): MeetingSession {
    const path = this.path(id);
    if (!existsSync(path)) throw new Error("Meeting session was not found.");
    return JSON.parse(readFileSync(path, "utf8")) as MeetingSession;
  }

  list(): MeetingSessionSummary[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const session = JSON.parse(readFileSync(join(this.root, name), "utf8")) as MeetingSession;
          return [{
            id: session.id,
            title: session.title,
            clientWorkspace: session.clientWorkspace,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            greetingSent: session.greetingSent,
            transcriptEvents: session.transcript.length,
          }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  delete(id: string): void {
    rmSync(this.path(id), { force: true });
  }

  private path(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid session identifier.");
    return resolve(this.root, `${id}.json`);
  }
}