import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class AudioControl {
  constructor(private readonly scriptPath: string, private readonly enabled: boolean) {}

  async status(): Promise<Record<string, unknown>> {
    const { stdout } = await execFileAsync("bash", [this.scriptPath, "status", "--json"]);
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  async start(): Promise<string> {
    this.assertEnabled();
    const { stdout } = await execFileAsync("bash", [this.scriptPath, "start"]);
    return stdout.trim();
  }

  async stop(): Promise<string> {
    const { stdout } = await execFileAsync("bash", [this.scriptPath, "stop"]);
    return stdout.trim();
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new Error("Audio control is disabled. Set VOICE_BRIDGE_ENABLE_AUDIO_CONTROL=true before creating virtual devices.");
  }
}