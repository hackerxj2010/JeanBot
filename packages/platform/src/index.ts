import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ServiceAuthContext, ServiceName } from "@jeanbot/types";

export interface JeanbotPlatformConfig {
  nodeEnv: string;
  persistenceMode: "local" | "postgres";
  queueMode: "local" | "redis";
  postgresUrl?: string | undefined;
  redisUrl?: string | undefined;
  internalServiceToken: string;
  authRequired: boolean;
  serviceMode: "local" | "http";
  serviceUrls: Record<ServiceName, string>;
  browserPublicBaseUrl: string;
  otelExporterUrl?: string | undefined;
  stripeSecretKey?: string | undefined;
  stripeWebhookSecret?: string | undefined;
  googleClientId?: string | undefined;
  googleClientSecret?: string | undefined;
  githubClientId?: string | undefined;
  githubClientSecret?: string | undefined;
  integrationEncryptionKey: string;
}

export class JeanbotError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown> | undefined;

  constructor(input: {
    message: string;
    statusCode: number;
    code: string;
    details?: Record<string, unknown> | undefined;
  }) {
    super(input.message);
    this.name = "JeanbotError";
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.details = input.details;
  }
}

export const isJeanbotError = (error: unknown): error is JeanbotError =>
  error instanceof JeanbotError;

const servicePortByName: Record<ServiceName, number> = {
  "api-gateway": 8080,
  "auth-service": 8081,
  "user-service": 8082,
  "agent-orchestrator": 8083,
  "agent-runtime": 8084,
  "tool-service": 8085,
  "memory-service": 8086,
  "policy-service": 8087,
  "audit-service": 8088,
  "automation-service": 8089,
  "communication-service": 8092,
  "knowledge-service": 8093,
  "billing-service": 8094,
  "browser-service": 8090,
  "terminal-service": 8091,
  "notification-service": 8095,
  "admin-service": 8096
};

const envNameForService = (service: ServiceName) => {
  return `${service.toUpperCase().replace(/-/g, "_")}_URL`;
};

let envFilesLoaded = false;

const stripWrappingQuotes = (value: string) => {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const parseEnvValue = (rawValue: string) => {
  const normalized = stripWrappingQuotes(rawValue.trim());
  return normalized
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
};

const applyEnvFile = (filePath: string) => {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1);
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseEnvValue(rawValue);
  }
};

const loadEnvFilesOnce = () => {
  if (envFilesLoaded) {
    return;
  }

  envFilesLoaded = true;
  const visited = new Set<string>();
  let currentDirectory = path.resolve(process.cwd());

  while (true) {
    for (const fileName of [".env", ".env.local"]) {
      const candidate = path.join(currentDirectory, fileName);
      if (!visited.has(candidate)) {
        applyEnvFile(candidate);
        visited.add(candidate);
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }

    currentDirectory = parentDirectory;
  }
};

loadEnvFilesOnce();

export const loadPlatformConfig = (): JeanbotPlatformConfig => {
  const serviceUrls = Object.keys(servicePortByName).reduce<Record<ServiceName, string>>(
    (accumulator, service) => {
      const typedService = service as ServiceName;
      accumulator[typedService] =
        process.env[envNameForService(typedService)] ??
        `http://127.0.0.1:${servicePortByName[typedService]}`;
      return accumulator;
    },
    {} as Record<ServiceName, string>
  );

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    persistenceMode: process.env.JEANBOT_PERSISTENCE_MODE === "postgres" ? "postgres" : "local",
    queueMode: process.env.JEANBOT_QUEUE_MODE === "redis" ? "redis" : "local",
    postgresUrl: process.env.POSTGRES_URL,
    redisUrl: process.env.REDIS_URL,
    internalServiceToken:
      process.env.INTERNAL_SERVICE_TOKEN ?? "jeanbot-internal-dev-token",
    authRequired: process.env.JEANBOT_AUTH_REQUIRED === "true",
    serviceMode: process.env.JEANBOT_SERVICE_MODE === "http" ? "http" : "local",
    serviceUrls,
    browserPublicBaseUrl:
      process.env.BROWSER_PUBLIC_BASE_URL ??
      process.env.BROWSER_SERVICE_URL ??
      serviceUrls["browser-service"],
    otelExporterUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    integrationEncryptionKey:
      process.env.JEANBOT_INTEGRATION_ENCRYPTION_KEY ?? "jeanbot-dev-encryption-key"
  };
};

export const buildInternalHeaders = (
  service: ServiceName,
  token = loadPlatformConfig().internalServiceToken
) => {
  return {
    "x-jeanbot-internal-service": service,
    "x-jeanbot-internal-token": token
  };
};

export const assertInternalRequest = (
  headers: Record<string, string | string[] | undefined>,
  token = loadPlatformConfig().internalServiceToken
) => {
  const internalToken = headers["x-jeanbot-internal-token"];
  if (!internalToken || internalToken !== token) {
    throw new Error("Unauthorized internal service request.");
  }
};

export const toServiceAuthContextHeader = (context: ServiceAuthContext) => {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64");
};

export const buildServiceHeaders = (
  service: ServiceName,
  authContext?: ServiceAuthContext,
  token = loadPlatformConfig().internalServiceToken
) => {
  return {
    ...buildInternalHeaders(service, token),
    ...(authContext
      ? {
          "x-jeanbot-auth-context": toServiceAuthContextHeader(authContext)
        }
      : {})
  };
};

export const fromServiceAuthContextHeader = (encoded?: string) => {
  if (!encoded) {
    return undefined;
  }

  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ServiceAuthContext;
};

export const hashApiKey = (rawKey: string) => {
  return crypto.hash("sha256", rawKey, "hex");
};

export const createApiKeyValue = () => {
  const token = crypto.randomBytes(24).toString("hex");
  return `jean_${token}`;
};

export const apiKeyPreview = (rawKey: string) => {
  return `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`;
};

export const serviceUrl = (service: ServiceName, config = loadPlatformConfig()) => {
  return config.serviceUrls[service];
};

export const authContextFromHeaders = (
  headers: Record<string, string | string[] | undefined>
) => {
  const header = headers["x-jeanbot-auth-context"];
  if (Array.isArray(header)) {
    return fromServiceAuthContextHeader(header[0]);
  }

  return fromServiceAuthContextHeader(header);
};

export const assertPermission = (authContext: ServiceAuthContext | undefined, permission: string) => {
  if (!authContext || !authContext.permissions.includes(permission)) {
    throw new Error(`Missing required permission "${permission}".`);
  }
};

export const assertWorkspaceAccess = (
  authContext: ServiceAuthContext | undefined,
  workspaceId: string | undefined
) => {
  if (!workspaceId || !authContext) {
    return;
  }

  if (!authContext.workspaceIds.includes(workspaceId)) {
    throw new Error(`Workspace "${workspaceId}" is outside the caller scope.`);
  }
};

export const fetchServiceJson = async <T>(
  url: string,
  init: RequestInit
): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Service request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};
