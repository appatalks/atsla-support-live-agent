import { describe, expect, it } from "vitest";
import { runSimulation } from "../src/simulation.js";

describe("meeting simulation", () => {
  it("requires approval then dispatches simulated speech", async () => {
    const result = await runSimulation("approval");
    expect(result.initialDisposition).toBe("pending-approval");
    expect(result.authorizedDispatch?.status).toBe("spoken");
    expect(result.state.speech).toHaveLength(1);
  });

  it("does not dispatch in suggestion-only mode", async () => {
    const result = await runSimulation("suggest");
    expect(result.initialDisposition).toBe("suggested");
    expect(result.authorizedDispatch).toBeUndefined();
    expect(result.state.speech).toHaveLength(0);
  });
});