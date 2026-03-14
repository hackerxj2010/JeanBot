import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8080);

const { app } = buildApp();

app
  .listen({
    port,
    host: "0.0.0.0"
  })
  .then(() => {
    console.log(`JeanBot API gateway listening on port ${port}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
