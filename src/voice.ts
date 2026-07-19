import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Draft } from "./domain.js";

export interface SpeechDispatch {
  id: string;
  draftId: string;
  status: "queued" | "spoken" | "cancelled";
  createdAt: string;
}

export interface SpeechOptions {
  exaggeration?: number;
  cfgWeight?: number;
  profileId?: string;
}

export interface SpeechOutput {
  dispatch(draft: Draft, options?: SpeechOptions): Promise<SpeechDispatch>;
  cancelAll(): void;
  history(): SpeechDispatch[];
  configureEndpoint?(endpoint: URL): void;
}

function requestHeaders(authToken?: string): Record<string, string> {
  return authToken?.trim()
    ? { "content-type": "application/json", authorization: `Bearer ${authToken.trim()}` }
    : { "content-type": "application/json" };
}

export class SimulatedSpeechOutput implements SpeechOutput {
  private readonly dispatches: SpeechDispatch[] = [];

  async dispatch(draft: Draft, _options?: SpeechOptions): Promise<SpeechDispatch> {
    const dispatch: SpeechDispatch = {
      id: randomUUID(),
      draftId: draft.id,
      status: "spoken",
      createdAt: new Date().toISOString(),
    };
    this.dispatches.push(dispatch);
    return dispatch;
  }

  cancelAll(): void {
    for (const dispatch of this.dispatches) {
      if (dispatch.status === "queued") dispatch.status = "cancelled";
    }
  }

  history(): SpeechDispatch[] {
    return [...this.dispatches];
  }
}

export class LocalVoiceBridgeOutput extends SimulatedSpeechOutput {
  constructor(
    private endpoint: URL,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly authToken?: string,
  ) {
    super();
  }

  configureEndpoint(endpoint: URL): void {
    this.endpoint = endpoint;
  }

  override async dispatch(draft: Draft, options?: SpeechOptions): Promise<SpeechDispatch> {
    const response = await this.fetchImplementation(new URL("v1/speech", this.endpoint), {
      method: "POST",
      headers: requestHeaders(this.authToken),
      body: JSON.stringify({ input: draft.reply.text, exaggeration: options?.exaggeration, cfg_weight: options?.cfgWeight, voice_profile: options?.profileId }),
    });
    if (!response.ok) {
      throw new Error(`Local voice bridge request failed with HTTP ${response.status}.`);
    }

    // The initial bridge returns a complete WAV. A PipeWire output adapter consumes the bytes next.
    await response.arrayBuffer();
    return super.dispatch(draft, options);
  }
}

export class PipeWireVoiceOutput extends SimulatedSpeechOutput {
  private readonly activeProcesses = new Set<ChildProcessWithoutNullStreams>();

  constructor(
    private endpoint: URL,
    private readonly target: string,
    private readonly spawnImplementation: typeof spawn = spawn,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly authToken?: string,
  ) {
    super();
  }

  configureEndpoint(endpoint: URL): void {
    this.endpoint = endpoint;
  }

  override async dispatch(draft: Draft, options?: SpeechOptions): Promise<SpeechDispatch> {
    const response = await this.fetchImplementation(new URL("v1/speech", this.endpoint), {
      method: "POST",
      headers: requestHeaders(this.authToken),
      body: JSON.stringify({ input: draft.reply.text, exaggeration: options?.exaggeration, cfg_weight: options?.cfgWeight, voice_profile: options?.profileId }),
    });
    if (!response.ok) throw new Error(`Local voice bridge request failed with HTTP ${response.status}.`);
    const audio = Buffer.from(await response.arrayBuffer());
    await this.play(audio);
    return super.dispatch(draft, options);
  }

  override cancelAll(): void {
    for (const process of this.activeProcesses) process.kill("SIGTERM");
    this.activeProcesses.clear();
    super.cancelAll();
  }

  private play(audio: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = this.spawnImplementation("pw-cat", ["--playback", "--target", this.target, "-"], { stdio: "pipe" });
      this.activeProcesses.add(process);
      process.once("error", reject);
      process.once("close", (code) => {
        this.activeProcesses.delete(process);
        code === 0 ? resolve() : reject(new Error(`pw-cat exited with code ${code ?? "unknown"}.`));
      });
      process.stdin.end(audio);
    });
  }
}

export class MacVoiceOutput extends SimulatedSpeechOutput {
  private readonly activeProcesses = new Set<ChildProcess>();

  constructor(
    private endpoint: URL,
    private readonly deviceId?: string,
    private readonly spawnImplementation: typeof spawn = spawn,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly authToken?: string,
  ) {
    super();
  }

  configureEndpoint(endpoint: URL): void {
    this.endpoint = endpoint;
  }

  override async dispatch(draft: Draft, options?: SpeechOptions): Promise<SpeechDispatch> {
    const response = await this.fetchImplementation(new URL("v1/speech", this.endpoint), {
      method: "POST",
      headers: requestHeaders(this.authToken),
      body: JSON.stringify({ input: draft.reply.text, exaggeration: options?.exaggeration, cfg_weight: options?.cfgWeight, voice_profile: options?.profileId }),
    });
    if (!response.ok) throw new Error(`Local voice bridge request failed with HTTP ${response.status}.`);
    const path = join(tmpdir(), `voice-bridge-${randomUUID()}.wav`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    try {
      await this.play(path);
      return super.dispatch(draft, options);
    } finally {
      await rm(path, { force: true });
    }
  }

  override cancelAll(): void {
    for (const process of this.activeProcesses) process.kill("SIGTERM");
    this.activeProcesses.clear();
    super.cancelAll();
  }

  private play(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = this.deviceId ? ["-d", this.deviceId, path] : [path];
      const process = this.spawnImplementation("afplay", args, { stdio: "ignore" });
      this.activeProcesses.add(process);
      process.once("error", reject);
      process.once("close", (code) => {
        this.activeProcesses.delete(process);
        code === 0 ? resolve() : reject(new Error(`afplay exited with code ${code ?? "unknown"}.`));
      });
    });
  }
}