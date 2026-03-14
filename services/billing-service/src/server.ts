import { buildBillingServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8094);
const { app } = buildBillingServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Billing service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
