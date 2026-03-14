import RedisMemoryServerModule from "redis-memory-server";

const configuredPort = Number(process.env.REDISMS_PORT ?? 6389);

const RedisMemoryServer =
  "default" in RedisMemoryServerModule
    ? RedisMemoryServerModule.default
    : RedisMemoryServerModule;

const server = new RedisMemoryServer({
  instance: {
    port: configuredPort
  }
});

const host = await server.getHost();
const port = await server.getPort();

console.log(`Redis server running at: ${host}:${port}`);

let shuttingDown = false;
const keepAlive = setInterval(() => {
  // Keep the helper process alive so the embedded Redis instance is not torn down.
}, 60_000);

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearInterval(keepAlive);
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("beforeExit", () => {
  void shutdown();
});
