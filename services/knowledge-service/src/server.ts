import { buildKnowledgeServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8093);
const { app } = buildKnowledgeServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Knowledge service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
