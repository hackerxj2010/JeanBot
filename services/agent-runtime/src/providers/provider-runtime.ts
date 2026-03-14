import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import { loadPlatformConfig } from "@jeanbot/platform";
import { decryptSecret } from "@jeanbot/security";
import type {
  ProviderExecutionRequest,
  ProviderExecutionResult,
  RuntimeProviderStatus
} from "@jeanbot/types";

export class ProviderRuntime {
  private readonly logger = createLogger("provider-runtime");
  private readonly persistence = createPersistenceBundle();
  private readonly config = loadPlatformConfig();

  private readonly providerCatalog = {
    anthropic: {
      defaultModel: "claude-sonnet-4-6",
      supportedModels: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
      configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
      message: () =>
        process.env.ANTHROPIC_API_KEY
          ? "Anthropic live execution is available."
          : "Set ANTHROPIC_API_KEY to enable Anthropic live execution."
    },
    openai: {
      defaultModel: "gpt-4.1-mini",
      supportedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
      configured: () => Boolean(process.env.OPENAI_API_KEY),
      message: () =>
        process.env.OPENAI_API_KEY
          ? "OpenAI live execution is available."
          : "Set OPENAI_API_KEY to enable OpenAI live execution."
    },
    ollama: {
      defaultModel: process.env.OLLAMA_MODEL ?? "glm-5:cloud",
      supportedModels: [
        process.env.OLLAMA_MODEL ?? "glm-5:cloud",
        "glm-5:cloud",
        "qwen3-coder:480b-cloud",
        "gpt-oss:120b-cloud"
      ],
      configured: () => true,
      message: () =>
        `Ollama live execution targets ${
          process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api"
        }. Ensure the Ollama daemon is running, and set OLLAMA_API_KEY if you are calling ollama.com directly.`
    },
    github: {
      defaultModel: "rest-v3",
      supportedModels: ["rest-v3"],
      configured: () => Boolean(process.env.GITHUB_TOKEN),
      message: () =>
        process.env.GITHUB_TOKEN
          ? "GitHub live execution is available."
          : "Set GITHUB_TOKEN to enable GitHub live execution."
    },
    playwright: {
      defaultModel: "browser-service",
      supportedModels: ["browser-service"],
      configured: () => false,
      message: () =>
        "Playwright live execution is delegated to browser-service; the runtime endpoint only exposes synthetic delegation."
    }
  } satisfies Record<
    ProviderExecutionRequest["provider"],
    {
      defaultModel: string;
      supportedModels: string[];
      configured: () => boolean;
      message: () => string;
    }
  >;

  private synthetic(request: ProviderExecutionRequest, message: string): ProviderExecutionResult {
    return {
      provider: request.provider,
      mode: "synthetic",
      ok: true,
      output: {
        prompt: request.prompt ?? "",
        input: request.input ?? {},
        summary: message
      },
      message
    };
  }

  private unavailableLiveProvider(
    request: ProviderExecutionRequest,
    requiredEnv: string,
    message: string
  ): ProviderExecutionResult {
    return {
      provider: request.provider,
      mode: "live",
      ok: false,
      output: {
        error: "missing_live_credentials",
        requiredEnv
      },
      message
    };
  }

  status(): RuntimeProviderStatus {
    const providers = (Object.entries(this.providerCatalog) as Array<
      [
        ProviderExecutionRequest["provider"],
        {
          defaultModel: string;
          supportedModels: string[];
          configured: () => boolean;
          message: () => string;
        }
      ]
    >).map(([provider, meta]) => {
      const configured = meta.configured();
      const liveAvailable = configured && provider !== "playwright";
      return {
        provider,
        configured,
        liveAvailable,
        defaultModel: meta.defaultModel,
        supportedModels: meta.supportedModels,
        message: meta.message()
      };
    });

    return {
      providers,
      liveProviders: providers
        .filter((provider) => provider.liveAvailable)
        .map((provider) => provider.provider),
      syntheticProviders: providers.map((provider) => provider.provider)
    };
  }

  async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    switch (request.provider) {
      case "anthropic":
        return this.executeAnthropic(request);
      case "openai":
        return this.executeOpenAi(request);
      case "ollama":
        return this.executeOllama(request);
      case "github":
        return this.executeGitHub(request);
      case "playwright":
        if (request.mode === "live") {
          return {
            provider: "playwright",
            mode: "live",
            ok: false,
            output: {
              error: "delegated_to_browser_service"
            },
            message:
              "Playwright live execution is handled by browser-service, not by the runtime provider adapter."
          };
        }

        return this.synthetic(
          request,
          "Playwright execution is owned by browser-service; runtime returned a synthetic delegation envelope."
        );
      default:
        return this.synthetic(request, "Unknown provider requested.");
    }
  }

  private async executeAnthropic(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResult> {
    if (!process.env.ANTHROPIC_API_KEY && request.mode === "live") {
      return this.unavailableLiveProvider(
        request,
        "ANTHROPIC_API_KEY",
        "Anthropic live mode was requested, but ANTHROPIC_API_KEY is not configured."
      );
    }

    if (!process.env.ANTHROPIC_API_KEY || request.mode === "synthetic") {
      return this.synthetic(
        request,
        "Anthropic live credentials are unavailable, so JeanBot used a synthetic response."
      );
    }

    const model = request.model ?? "claude-sonnet-4-6";
    const result = await generateText({
      model: anthropic(model),
      prompt: request.prompt ?? "Respond with a concise backend execution summary."
    });

    this.logger.info("Executed Anthropic provider request", {
      model
    });

    return {
      provider: "anthropic",
      mode: "live",
      ok: true,
      output: {
        text: result.text,
        finishReason: result.finishReason
      },
      message: "Anthropic request completed successfully."
    };
  }

  private async executeOpenAi(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResult> {
    if (!process.env.OPENAI_API_KEY && request.mode === "live") {
      return this.unavailableLiveProvider(
        request,
        "OPENAI_API_KEY",
        "OpenAI live mode was requested, but OPENAI_API_KEY is not configured."
      );
    }

    if (!process.env.OPENAI_API_KEY || request.mode === "synthetic") {
      return this.synthetic(
        request,
        "OpenAI live credentials are unavailable, so JeanBot used a synthetic response."
      );
    }

    const model = request.model ?? "gpt-4.1-mini";
    const result = await generateText({
      model: openai(model),
      prompt: request.prompt ?? "Respond with a concise backend execution summary."
    });

    this.logger.info("Executed OpenAI provider request", {
      model
    });

    return {
      provider: "openai",
      mode: "live",
      ok: true,
      output: {
        text: result.text,
        finishReason: result.finishReason
      },
      message: "OpenAI request completed successfully."
    };
  }

  private resolveOllamaBaseUrl() {
    const configured = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").trim();
    const normalized = configured.replace(/\/+$/, "");
    return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
  }

  private async executeOllama(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResult> {
    if (request.mode === "synthetic") {
      return this.synthetic(
        request,
        "Ollama synthetic mode was requested, so JeanBot skipped the live Ollama call."
      );
    }

    const model = request.model ?? process.env.OLLAMA_MODEL ?? "glm-5:cloud";
    const baseUrl = this.resolveOllamaBaseUrl();
    const rawMessages = Array.isArray(request.input?.messages)
      ? request.input?.messages
      : undefined;
    const messages =
      rawMessages?.filter(
        (message): message is { role: string; content: string } =>
          Boolean(
            message &&
              typeof message === "object" &&
              typeof (message as { role?: unknown }).role === "string" &&
              typeof (message as { content?: unknown }).content === "string"
          )
      ) ?? [
        {
          role: "user",
          content: request.prompt ?? "Respond with a concise backend execution summary."
        }
      ];

    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (process.env.OLLAMA_API_KEY) {
      headers.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream: false
        })
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Ollama request failure.";
      return {
        provider: "ollama",
        mode: "live",
        ok: false,
        output: {
          error: "ollama_connection_failed",
          baseUrl
        },
        message: `Ollama live request failed to reach ${baseUrl}: ${message}`
      };
    }

    if (!response.ok) {
      const failureBody = await response.text();
      return {
        provider: "ollama",
        mode: "live",
        ok: false,
        output: {
          error: "ollama_http_error",
          status: response.status,
          body: failureBody.slice(0, 500)
        },
        message: `Ollama live request failed with status ${response.status}.`
      };
    }

    const output = (await response.json()) as {
      message?: {
        role?: string;
        content?: string;
      };
      done_reason?: string;
      total_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
      model?: string;
    };

    this.logger.info("Executed Ollama provider request", {
      model,
      baseUrl
    });

    return {
      provider: "ollama",
      mode: "live",
      ok: true,
      output: {
        text: output.message?.content ?? "",
        role: output.message?.role ?? "assistant",
        doneReason: output.done_reason,
        totalDuration: output.total_duration,
        promptEvalCount: output.prompt_eval_count,
        evalCount: output.eval_count,
        model: output.model ?? model
      },
      message: "Ollama request completed successfully."
    };
  }

  private async executeGitHub(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResult> {
    const resource =
      typeof request.input?.resource === "string" ? request.input.resource : "rate_limit";
    const workspaceId =
      typeof request.input?.workspaceId === "string" ? request.input.workspaceId : undefined;
    const integration =
      workspaceId ? await this.persistence.integrations.get(workspaceId, "github") : undefined;
    const integrationToken =
      integration?.status === "connected" && integration.encryptedAccessToken
        ? decryptSecret(integration.encryptedAccessToken)
        : undefined;
    const githubToken = integrationToken ?? process.env.GITHUB_TOKEN;

    if (!githubToken && request.mode === "live") {
      return this.unavailableLiveProvider(
        request,
        "GITHUB_TOKEN or workspace GitHub OAuth",
        `GitHub live mode was requested for resource "${resource}", but no GitHub token is configured for the current workspace.`
      );
    }

    if (!githubToken || request.mode === "synthetic") {
      return this.synthetic(
        request,
        `GitHub live credentials are unavailable; synthetic response returned for resource "${resource}".`
      );
    }

    const response = await fetch(`https://api.github.com/${resource}`, {
      headers: {
        authorization: `Bearer ${githubToken}`,
        "user-agent": "jeanbot-runtime",
        accept: "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub request failed with status ${response.status}.`);
    }

    const output = (await response.json()) as Record<string, unknown>;
    this.logger.info("Executed GitHub provider request", {
      resource
    });

    return {
      provider: "github",
      mode: "live",
      ok: true,
      output,
      message: integrationToken
        ? "GitHub request completed successfully using a workspace OAuth token."
        : "GitHub request completed successfully."
    };
  }
}
