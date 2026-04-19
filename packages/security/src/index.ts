import type { RiskLevel, ToolDescriptor } from "@jeanbot/types";
import crypto from "node:crypto";

const criticalTerms = [
  "delete",
  "transfer",
  "purchase",
  "payment",
  "production",
  "invoice",
  "email send"
] as const;

const highTerms = ["deploy", "publish", "backup", "restore", "credentials"] as const;

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
  return input
    .replace(/\bsk-ant-[A-Za-z0-9_-]+\b/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\bAIza[A-Za-z0-9_-]+\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\bsk_(?:live|test|restricted)_[A-Za-z0-9_]+\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bjean_[A-Za-z0-9_]+\b/g, "[REDACTED_JEANBOT_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+\b/g, "Bearer [REDACTED_TOKEN]");
};

export const ensureLeastPrivilege = (
  tool: ToolDescriptor,
  requestedPermissions: string[]
) => {
    return requestedPermissions.every((permission) => tool.permissions.includes(permission));
};

const encryptionKey = () => {
  const secret = process.env.JEANBOT_INTEGRATION_ENCRYPTION_KEY ?? "jeanbot-dev-encryption-key";
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
