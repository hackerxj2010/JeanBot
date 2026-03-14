import { buildTerminalServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8091);
const { app } = buildTerminalServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Terminal service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
