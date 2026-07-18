import { buildServer } from "./server.js";

const server = buildServer();
const port = Number(process.env.PORT ?? 4173);

server.listen({ host: "127.0.0.1", port }).catch((error: unknown) => {
  server.log.error(error);
  process.exit(1);
});