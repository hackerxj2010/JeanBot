import { buildBrowserServiceApp } from "./index.js";

const start = async () => {
  const port = Number(process.env.PORT ?? 8090);
  const host = process.env.HOST ?? "0.0.0.0";
  const { app } = await buildBrowserServiceApp();
  await app.listen({
    port,
    host
  });
};

void start();
