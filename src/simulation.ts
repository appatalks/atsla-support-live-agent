import { MeetingCoordinator } from "./coordinator.js";
import { type ResponseMode } from "./domain.js";
import { DraftStore, ResponsePolicy } from "./policy.js";
import { SimulationProvider } from "./providers.js";
import { SimulatedSpeechOutput } from "./voice.js";

export async function runSimulation(mode: ResponseMode = "approval") {
  const speech = new SimulatedSpeechOutput();
  const coordinator = new MeetingCoordinator(new SimulationProvider(), new ResponsePolicy(mode), new DraftStore(), speech);

  coordinator.ingest({
    id: "remote-1",
    speaker: "remote",
    text: "We need to confirm the release date before the customer call.",
    occurredAt: "2026-07-18T14:00:00.000Z",
  });
  const result = await coordinator.draft("What should we say about the release date?");
  const initialDisposition = result.draft.disposition;
  const authorized = result.draft.disposition === "pending-approval"
    ? await coordinator.authorize(result.draft.id)
    : undefined;

  return {
    initialDisposition,
    authorizedDispatch: authorized?.dispatch ?? result.dispatch,
    state: coordinator.state(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSimulation().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}