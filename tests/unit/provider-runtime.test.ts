import { describe, expect, it } from "vitest";

import { ProviderRuntime } from "../../services/agent-runtime/src/providers/provider-runtime.js";

describe("Provider runtime", () => {
  it("falls back to synthetic mode when live credentials are missing", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    process.env.GITHUB_TOKEN = "";

    const runtime = new ProviderRuntime();
    const [anthropicResult, openAiResult, gitHubResult] = await Promise.all([
      runtime.execute({
        provider: "anthropic",
        prompt: "Summarize this."
      }),
      runtime.execute({
        provider: "openai",
        prompt: "Summarize this."
      }),
      runtime.execute({
        provider: "github",
        input: {
          resource: "rate_limit"
        }
      })
    ]);

    expect(anthropicResult.mode).toBe("synthetic");
    expect(openAiResult.mode).toBe("synthetic");
    expect(gitHubResult.mode).toBe("synthetic");
  });
});
