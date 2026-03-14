import type { FastifyInstance } from "fastify";
import type { GatewayServices } from "../services/gateway-services.js";

export const registerSystemRoutes = (
  app: FastifyInstance,
  services: GatewayServices
) => {
  app.get("/health", async () => {
    return {
      ok: true,
      ...(await services.health())
    };
  });

  app.get("/system/summary", async (request) => {
    const authContext = (request as typeof request & { authContext?: import("@jeanbot/types").ServiceAuthContext }).authContext;
    return services.summary(authContext);
  });
};
