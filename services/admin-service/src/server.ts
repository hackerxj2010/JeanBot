import { buildAdminServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8096);
const { app } = buildAdminServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Admin service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
