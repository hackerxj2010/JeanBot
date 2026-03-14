import { startQueueWorker } from "./runtime.js";

const worker = await startQueueWorker();
if (!worker.started) {
  process.exit(0);
}

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

await new Promise(() => {});
