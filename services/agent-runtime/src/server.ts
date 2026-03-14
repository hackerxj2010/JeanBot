import { buildAgentRuntimeApp } from "./app.js";

const port = Number(process.env.PORT ?? 8084);
const { app } = buildAgentRuntimeApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Agent runtime listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
