import type { RiskLevel, ToolDescriptor } from "@jeanbot/types";
import crypto from "node:crypto";

const criticalTerms = [
  "delete",
  "transfer",
  "purchase",
  "payment",
  "production",
  "invoice",
  "email send",
  "destroy",
  "wipe",
  "truncate",
  "drop table"
] as const;

const highTerms = [
  "deploy",
  "publish",
  "backup",
  "restore",
  "credentials",
  "secret",
  "token",
  "password"
] as const;

export const riskFromText = (text: string): RiskLevel => {
  const normalized = text.toLowerCase();
  if (criticalTerms.some((term) => normalized.includes(term))) {
    return "critical";
  }

  if (highTerms.some((term) => normalized.includes(term))) {
    return "high";
  }

  if (normalized.includes("monitor") || normalized.includes("analyze")) {
    return "medium";
  }

  return "low";
};

export const redactSecrets = (input: string) => {
  if (!input) return input;

  return input
    // Anthropic
    .replace(/(?<![\w-])sk-ant-[A-Za-z0-9_-]+(?![\w-])/g, "[REDACTED_ANTHROPIC_KEY]")
    // OpenAI
    .replace(/(?<![\w-])sk-[A-Za-z0-9_-]+(?![\w-])/g, "[REDACTED_OPENAI_KEY]")
    // Google
    .replace(/(?<![\w-])AIza[A-Za-z0-9_-]+(?![\w-])/g, "[REDACTED_GOOGLE_KEY]")
    // Stripe
    .replace(/(?<![\w-])sk_(?:live|test|restricted)_[A-Za-z0-9]+(?![\w-])/g, "[REDACTED_STRIPE_KEY]")
    // GitHub
    .replace(/(?<![\w-])gh[porsut]_[A-Za-z0-9]+(?![\w-])/g, "[REDACTED_GITHUB_TOKEN]")
    // JeanBot
    .replace(/(?<![\w-])jean_[A-Za-z0-9]+(?![\w-])/g, "[REDACTED_JEANBOT_KEY]")
    // Generic Bearer
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED_TOKEN]");
};

export const sanitizeData = <T>(data: T): T => {
  if (data === null || data === undefined) {
    return data;
  }

  if (data instanceof Date) {
    return new Date(data.getTime()) as any;
  }

  if (typeof data === "string") {
    return redactSecrets(data) as any;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item)) as any;
  }

  if (typeof data === "object") {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeData(value);
    }
    return sanitized;
  }

  return data;
};

export const ensureLeastPrivilege = (
  tool: ToolDescriptor,
  requestedPermissions: string[]
) => {
    return requestedPermissions.every((permission) => tool.permissions.includes(permission));
};

const encryptionKey = () => {
  const secret = process.env.JEANBOT_INTEGRATION_ENCRYPTION_KEY ?? "jeanbot-dev-encryption-key";
  if (typeof (crypto as any).hash === 'function') {
    return (crypto as any).hash("sha256", secret, "buffer");
  }
  return crypto.createHash("sha256").update(secret).digest();
};

export const encryptSecret = (plaintext: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
};

export const decryptSecret = (ciphertext: string | undefined) => {
  if (!ciphertext) {
    return undefined;
  }

  const payload = Buffer.from(ciphertext, "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const body = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
};
