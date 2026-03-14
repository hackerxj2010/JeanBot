import { buildUserServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8082);
const { app } = buildUserServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`User service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
