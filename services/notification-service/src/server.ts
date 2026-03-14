import { buildNotificationServiceApp } from "./index.js";

const port = Number(process.env.PORT ?? 8095);
const { app } = buildNotificationServiceApp();

app
  .listen({
    host: "0.0.0.0",
    port
  })
  .then(() => {
    console.log(`Notification service listening on ${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
