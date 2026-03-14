import { buildAgentOrchestratorApp } from "./app.js";

const port = Number(process.env.PORT ?? 8083);
const { app } = buildAgentOrchestratorApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Agent orchestrator listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
