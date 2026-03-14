export const stringValue = (
  payload: Record<string, unknown>,
  key: string,
  fallback = ""
) => {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
};

export const optionalStringValue = (
  payload: Record<string, unknown>,
  key: string
) => {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
};

export const numberValue = (
  payload: Record<string, unknown>,
  key: string,
  fallback: number
) => {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const booleanValue = (
  payload: Record<string, unknown>,
  key: string,
  fallback = false
) => {
  const value = payload[key];
  return typeof value === "boolean" ? value : fallback;
};

export const stringArrayValue = (
  payload: Record<string, unknown>,
  key: string
) => {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
};

export const recordValue = (
  payload: Record<string, unknown>,
  key: string
) => {
  const value = payload[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

export const channelValue = (
  payload: Record<string, unknown>
): "email" | "slack" | "push" => {
  const channel = payload.channel;
  if (channel === "slack" || channel === "push") {
    return channel;
  }

  return "email";
};

export const workspaceIdFromPayload = (
  payload: Record<string, unknown>
) => {
  const workspaceId = optionalStringValue(payload, "workspaceId");
  if (workspaceId) {
    return workspaceId;
  }

  return optionalStringValue(payload, "targetWorkspaceId");
};

export const requestPermissions = (payload: Record<string, unknown>) =>
  stringArrayValue(payload, "permissions");

export const approvalFlag = (payload: Record<string, unknown>) => {
  const value = payload.approved;
  return value === true;
};

export const jsonPreview = (value: unknown, maxLength = 320) => {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...` : serialized;
};

export const sanitizePayloadForAudit = (
  payload: Record<string, unknown>
) => {
  const sensitiveKeys = new Set([
    "token",
    "apiKey",
    "accessToken",
    "refreshToken",
    "authorization",
    "password",
    "secret",
    "cookie"
  ]);

  const sanitizedEntries = Object.entries(payload).map(([key, value]) => {
    if (sensitiveKeys.has(key)) {
      return [key, "[redacted]"] as const;
    }

    if (typeof value === "string" && value.length > 500) {
      return [key, `${value.slice(0, 500)}...`] as const;
    }

    return [key, value] as const;
  });

  return Object.fromEntries(sanitizedEntries);
};
