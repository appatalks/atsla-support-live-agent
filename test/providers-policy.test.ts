import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotAcpProvider, LocalQwenProvider, OpenAiCompatibleProvider, ProviderRouter, SimulationProvider } from "../src/providers.js";
import { MeetingCoordinator } from "../src/coordinator.js";
import { LocalVoiceBridgeOutput, SimulatedSpeechOutput } from "../src/voice.js";
import { DraftStore, ResponsePolicy } from "../src/policy.js";

describe("response policy", () => {
  it("requires approval by default", () => {
    const policy = new ResponsePolicy();
    expect(policy.disposition("What is the delivery date?")).toBe("pending-approval");
  });

  it("only speaks guarded-autonomously after direct address", () => {
    const policy = new ResponsePolicy("guarded-autonomous");
    expect(policy.disposition("What is the delivery date?")).toBe("pending-approval");
    expect(policy.disposition("Agent, what is the delivery date?")).toBe("authorized");
  });
});

describe("simulation provider", () => {
  it("creates a deterministic spoken draft", async () => {
    const provider = new SimulationProvider();
    const reply = await provider.complete({ transcript: [], question: "What is the delivery date?" });
    const drafts = new DraftStore();
    const draft = drafts.create("What is the delivery date?", reply, "pending-approval");

    expect(reply.text).toContain("What is the delivery date?");
    expect(drafts.authorize(draft.id).disposition).toBe("authorized");
  });

  it("dismisses an unsent reply", async () => {
    const provider = new SimulationProvider();
    const reply = await provider.complete({ transcript: [], question: "Hold this reply." });
    const drafts = new DraftStore();
    const draft = drafts.create("Hold this reply.", reply, "pending-approval");

    expect(drafts.dismiss(draft.id).disposition).toBe("dismissed");
  });

  it("speaks an operator template without waiting for model generation", async () => {
    const coordinator = new MeetingCoordinator(
      new SimulationProvider(),
      new ResponsePolicy("approval"),
      new DraftStore(),
      new SimulatedSpeechOutput(),
    );
    const result = await coordinator.speakTemplate("Welcome to the meeting.");

    expect(result.draft.reply.model).toBe("operator-template");
    expect(result.dispatch.status).toBe("spoken");
  });
});

describe("voice expression controls", () => {
  it("passes exaggeration and CFG weight to the voice bridge", async () => {
    let payload: Record<string, unknown> = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 });
    };
    const output = new LocalVoiceBridgeOutput(new URL("http://127.0.0.1:8090/"), fakeFetch);
    const reply = await new SimulationProvider().complete({ transcript: [], question: "Status?" });
    const draft = new DraftStore().create("Status?", reply, "authorized");

    await output.dispatch(draft, { exaggeration: 0.7, cfgWeight: 0.3 });
    expect(payload).toMatchObject({ exaggeration: 0.7, cfg_weight: 0.3 });
  });
});

describe("autonomous meeting replies", () => {
  afterEach(() => vi.useRealTimers());

  it("only responds autonomously to a direct request", async () => {
    const coordinator = new MeetingCoordinator(
      new SimulationProvider(),
      new ResponsePolicy("autonomous"),
      new DraftStore(),
      new SimulatedSpeechOutput(),
    );

    await coordinator.ingest({ id: "fragment", speaker: "remote", text: "We are reviewing the plan", occurredAt: new Date().toISOString() });
    expect(coordinator.state().speech).toHaveLength(0);

    await coordinator.ingest({ id: "request", speaker: "remote", text: "Agent, can you summarize the plan?", occurredAt: new Date().toISOString() });
    expect(coordinator.state().speech).toHaveLength(1);
    expect(coordinator.state().drafts[0].disposition).toBe("authorized");
  });

  it("responds after the end-of-turn pause without needing a question mark", async () => {
    vi.useFakeTimers();
    const coordinator = new MeetingCoordinator(
      new SimulationProvider(),
      new ResponsePolicy("autonomous"),
      new DraftStore(),
      new SimulatedSpeechOutput(),
    );

    await coordinator.ingest({ id: "turn", speaker: "remote", text: "The customer needs an update today", occurredAt: new Date().toISOString() });
    expect(coordinator.state().speech).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4_500);
    expect(coordinator.state().speech).toHaveLength(1);
  });
});

describe("live representative escalation", () => {
  it("detects a request split across transcript chunks and supports acknowledgement", async () => {
    const coordinator = new MeetingCoordinator(
      new SimulationProvider(),
      new ResponsePolicy("autonomous"),
      new DraftStore(),
      new SimulatedSpeechOutput(),
    );

    await coordinator.ingest({ id: "one", speaker: "remote", text: "Can I have a live", occurredAt: new Date().toISOString() });
    await coordinator.ingest({ id: "two", speaker: "remote", text: "representative please", occurredAt: new Date().toISOString() });
    const escalation = coordinator.state().escalations[0];

    expect(escalation.status).toBe("pending");
    expect(coordinator.state().activity.some((activity) => activity.message.includes("Operator intervention required"))).toBe(true);
    expect(coordinator.state().drafts[0].reply.text).toBe("Absolutely. I'm notifying a live representative now. Please hold for just a moment.");
    expect(coordinator.state().drafts[0].reply.text).not.toContain("detectEscalation");
    expect(coordinator.acknowledgeEscalation(escalation.id).status).toBe("acknowledged");
  });
});

describe("network provider contracts", () => {
  it("sends Qwen3 through an OpenAI-compatible local endpoint", async () => {
    let receivedUrl = "";
    let receivedPayload: Record<string, unknown> = {};
    const fakeFetch: typeof fetch = async (input, init) => {
      receivedUrl = String(input);
      receivedPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Qwen reply" } }] }), { status: 200 });
    };
    const provider = new OpenAiCompatibleProvider(new URL("http://127.0.0.1:1234/v1/"), "qwen3-8b", fakeFetch);
    const reply = await provider.complete({ transcript: [], question: "Summarize the decision." });

    expect(receivedUrl).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(receivedPayload.model).toBe("Qwen/Qwen3-8B");
    expect(reply.text).toBe("Qwen reply");
  });

  it("uses EVA's local ACP bridge contract for Copilot", async () => {
    let receivedUrl = "";
    let receivedPayload: Record<string, unknown> = {};
    const fakeFetch: typeof fetch = async (input, init) => {
      receivedUrl = String(input);
      receivedPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Copilot reply" } }] }), { status: 200 });
    };
    const provider = new CopilotAcpProvider(new URL("http://127.0.0.1:8888/"), "claude-sonnet-4.6", fakeFetch);
    const reply = await provider.complete({ transcript: [], question: "Provide a concise answer." });

    expect(receivedUrl).toBe("http://127.0.0.1:8888/v1/chat/completions");
    expect(receivedPayload.acp_model).toBe("claude-sonnet-4.6");
    expect(reply.text).toBe("Copilot reply");
  });

  it("uses the local Qwen bridge model key rather than a cloud model identifier", async () => {
    let receivedPayload: Record<string, unknown> = {};
    const fakeFetch: typeof fetch = async (_input, init) => {
      receivedPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: "Qwen/Qwen3-8B",
        choices: [{ message: { content: "Local reply" } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        metrics: { duration_seconds: 0.5, tokens_per_second: 10 },
      }), { status: 200 });
    };
    const provider = new LocalQwenProvider(new URL("http://127.0.0.1:8001/"), "qwen3-8b", fakeFetch);
    const reply = await provider.complete({ transcript: [], question: "State the meeting status." });

    expect(receivedPayload.model).toBe("qwen3-8b");
    expect(reply.provider).toBe("local-qwen");
    expect(reply.model).toBe("Qwen/Qwen3-8B");
    expect(reply.usage).toMatchObject({ promptTokens: 20, completionTokens: 5, totalTokens: 25, tokensPerSecond: 10, exact: true });
  });

  it("switches between local Qwen and Copilot at runtime", async () => {
    const localFetch: typeof fetch = async () => new Response(JSON.stringify({ model: "Qwen/Qwen3-8B", choices: [{ message: { content: "Local" } }] }), { status: 200 });
    const copilotFetch: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Copilot" } }] }), { status: 200 });
    const router = new ProviderRouter(
      new LocalQwenProvider(new URL("http://127.0.0.1:8001/"), "qwen3-8b", localFetch),
      new CopilotAcpProvider(new URL("http://127.0.0.1:8888/"), "auto", copilotFetch),
    );

    expect((await router.complete({ transcript: [], question: "Status?" })).text).toBe("Local");
    router.setProvider("copilot-acp");
    expect((await router.complete({ transcript: [], question: "Status?" })).text).toBe("Copilot");
  });
});

describe("session telemetry", () => {
  it("aggregates exact provider token usage and throughput", async () => {
    const provider = {
      id: "local-qwen" as const,
      complete: async () => ({
        text: "Ready.",
        provider: "local-qwen" as const,
        model: "Qwen/Qwen3-8B",
        usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18, durationSeconds: 0.5, tokensPerSecond: 12, exact: true },
      }),
    };
    const coordinator = new MeetingCoordinator(provider, new ResponsePolicy("approval"), new DraftStore(), new SimulatedSpeechOutput());

    await coordinator.respondToConversation("Confirm status.");
    expect(coordinator.state().telemetry).toMatchObject({ requests: 1, promptTokens: 12, completionTokens: 6, totalTokens: 18, averageTokensPerSecond: 12, usageAvailable: true });
  });
});