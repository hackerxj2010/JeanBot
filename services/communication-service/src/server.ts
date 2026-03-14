import { buildCommunicationServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8092);
const { app } = buildCommunicationServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Communication service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
