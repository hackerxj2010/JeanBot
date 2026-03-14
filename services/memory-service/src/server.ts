import { buildMemoryServiceApp } from "./index.js";

const start = async () => {
  const port = Number(process.env.PORT ?? 8086);
  const host = process.env.HOST ?? "0.0.0.0";
  const { app } = buildMemoryServiceApp();
  await app.listen({
    port,
    host
  });
};

void start();
