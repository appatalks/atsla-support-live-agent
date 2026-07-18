import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("transcription turn assembly", () => {
  it("buffers consecutive speech chunks and posts only when silence ends the turn", () => {
    const script = readFileSync(`${root}/tools/transcribe-stream.sh`, "utf8");

    expect(script).toContain('pending_text=""');
    expect(script).toContain("deliver_pending() {");
    expect(script).toContain("if ! has_speech_level \"$chunk\"; then");
    expect(script).toContain("deliver_pending\n        continue");
    expect(script).toContain('pending_text="${pending_text:+$pending_text }$text"');
    expect(script).toContain("trap 'deliver_pending;");
  });
});