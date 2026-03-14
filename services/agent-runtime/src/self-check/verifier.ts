import { redactSecrets } from "@jeanbot/security";

export const verifyAndSanitize = (value: string) => {
  const sanitized = redactSecrets(value);
  const ok = sanitized.trim().length > 0;

  return {
    ok,
    sanitized,
    reason: ok ? "Output passed runtime self-check." : "Output was empty."
  };
};
