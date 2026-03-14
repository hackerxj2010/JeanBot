import { buildAuthServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8081);
const { app } = buildAuthServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Auth service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
