import { startHeartbeatWorker } from "./runtime.js";

const worker = await startHeartbeatWorker();

const shutdown = async () => {
  await worker.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
