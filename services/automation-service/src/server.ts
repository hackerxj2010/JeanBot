import { buildAutomationServiceApp } from "./app.js";

const port = Number(process.env.PORT ?? 8089);
const { app } = buildAutomationServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Automation service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
