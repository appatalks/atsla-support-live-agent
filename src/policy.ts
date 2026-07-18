import { randomUUID } from "node:crypto";
import { type Draft, type ModelReply, type ResponseMode } from "./domain.js";

const directAddress = /\b(agent|assistant|eva)\b/i;

export class ResponsePolicy {
  private mode: ResponseMode;

  constructor(initialMode: ResponseMode = "approval") {
    this.mode = initialMode;
  }

  setMode(mode: ResponseMode): void {
    this.mode = mode;
  }

  getMode(): ResponseMode {
    return this.mode;
  }

  disposition(question: string): Draft["disposition"] {
    if (this.mode === "disabled") return "blocked";
    if (this.mode === "suggest") return "suggested";
    if (this.mode === "approval") return "pending-approval";
    if (this.mode === "guarded-autonomous" && !directAddress.test(question)) return "pending-approval";
    return "authorized";
  }
}

export class DraftStore {
  private readonly drafts = new Map<string, Draft>();

  create(question: string, reply: ModelReply, disposition: Draft["disposition"]): Draft {
    const draft: Draft = {
      id: randomUUID(),
      question,
      reply,
      disposition,
      createdAt: new Date().toISOString(),
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  authorize(draftId: string): Draft {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error("Draft was not found.");
    if (draft.disposition === "blocked") throw new Error("Blocked drafts cannot be authorized.");
    draft.disposition = "authorized";
    return draft;
  }

  dismiss(draftId: string): Draft {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error("Draft was not found.");
    if (draft.disposition !== "pending-approval" && draft.disposition !== "suggested") {
      throw new Error("Only unsent replies can be dismissed.");
    }
    draft.disposition = "dismissed";
    return draft;
  }

  list(): Draft[] {
    return [...this.drafts.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  replace(drafts: Draft[]): void {
    this.drafts.clear();
    for (const draft of drafts) this.drafts.set(draft.id, structuredClone(draft));
  }
}