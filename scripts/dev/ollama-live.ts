import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildApp } from "../../services/api-gateway/src/app.js";

interface BootstrapResponse {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    tenantId: string;
  };
  apiKey: {
    id: string;
    preview: string;
  };
  rawApiKey: string;
}

interface RuntimeProvidersResponse {
  providers: Array<{
    provider: string;
    configured: boolean;
    liveAvailable: boolean;
    defaultModel: string;
    supportedModels: string[];
    message: string;
  }>;
  liveProviders: string[];
  syntheticProviders: string[];
}

interface RuntimeExecuteResponse {
  finalText: string;
  provider: string;
  model: string;
  mode: string;
  promptDigest: string;
}

interface RuntimeSessionResponse {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

interface RuntimeSessionDetailResponse {
  id: string;
  workspaceId: string;
  finalText?: string | undefined;
  model: {
    provider: string;
    model: string;
    reason: string;
  };
  iterations: Array<{
    index: number;
    provider: string;
    model: string;
  }>;
  providerResponses: Array<{
    provider: string;
    mode: string;
    ok: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface OllamaDaemonProbe {
  ok: boolean;
  baseUrl: string;
  model: string;
  tagsStatus?: number | undefined;
  availableModels?: string[] | undefined;
  chatStatus?: number | undefined;
  responseText?: string | undefined;
  error?: string | undefined;
}

const suffix = Date.now().toString();
const defaultReportPath = path.resolve("tmp", "ollama-live-report.json");

const resolveBaseUrl = () => {
  const configured = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").trim();
  return configured.replace(/\/+$/, "");
};

const buildOllamaHeaders = () => {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (process.env.OLLAMA_API_KEY) {
    headers.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }

  return headers;
};

const probeOllamaDaemon = async (
  baseUrl: string,
  model: string
): Promise<OllamaDaemonProbe> => {
  const headers = buildOllamaHeaders();
  const probe: OllamaDaemonProbe = {
    ok: false,
    baseUrl,
    model
  };

  try {
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      headers
    });
    probe.tagsStatus = tagsResponse.status;
    if (tagsResponse.ok) {
      const tagsBody = (await tagsResponse.json()) as {
        models?: Array<{ name?: string }>;
      };
      probe.availableModels =
        tagsBody.models
          ?.map((candidate) => candidate.name)
          .filter((candidate): candidate is string => typeof candidate === "string") ?? [];
    }

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "user",
            content: "Reply in one sentence and identify the runtime model."
          }
        ]
      })
    });
    probe.chatStatus = chatResponse.status;

    if (!chatResponse.ok) {
      probe.error = `Chat probe failed with status ${chatResponse.status}.`;
      return probe;
    }

    const chatBody = (await chatResponse.json()) as {
      message?: {
        content?: string;
      };
    };
    probe.responseText = chatBody.message?.content ?? "";
    probe.ok = true;
    return probe;
  } catch (error) {
    probe.error = error instanceof Error ? error.message : "Unknown Ollama daemon probe failure.";
    return probe;
  }
};

const run = async () => {
  process.env.JEANBOT_AUTH_REQUIRED = process.env.JEANBOT_AUTH_REQUIRED ?? "true";
  process.env.JEANBOT_MODEL_PROVIDER = process.env.JEANBOT_MODEL_PROVIDER ?? "ollama";

  const ollamaBaseUrl = resolveBaseUrl();
  const ollamaModel = process.env.OLLAMA_MODEL ?? "glm-5:cloud";

  const daemonProbe = await probeOllamaDaemon(ollamaBaseUrl, ollamaModel);
  if (!daemonProbe.ok) {
    throw new Error(
      `Ollama daemon probe failed for ${ollamaBaseUrl} and model "${ollamaModel}": ${
        daemonProbe.error ?? "no response"
      }`
    );
  }

  const { app } = buildApp();
  const bootstrapResponse = await app.inject({
    method: "POST",
    url: "/api/bootstrap",
    payload: {
      tenantName: "Ollama Live Tenant",
      tenantSlug: `ollama-live-tenant-${suffix}`,
      email: `ollama-live-${suffix}@example.com`,
      displayName: "Ollama Live Operator",
      workspaceName: "Ollama Live Workspace",
      workspaceSlug: `ollama-live-workspace-${suffix}`,
      apiKeyLabel: "ollama-live-key"
    }
  });

  if (bootstrapResponse.statusCode !== 200) {
    throw new Error(`Bootstrap failed: ${bootstrapResponse.body}`);
  }

  const bootstrap = bootstrapResponse.json() as BootstrapResponse;
  const headers = {
    "x-api-key": bootstrap.rawApiKey
  };

  const providersResponse = await app.inject({
    method: "GET",
    url: "/api/runtime/providers",
    headers
  });
  if (providersResponse.statusCode !== 200) {
    throw new Error(`Runtime provider status failed: ${providersResponse.body}`);
  }

  const providerStatus = providersResponse.json() as RuntimeProvidersResponse;

  const executeResponse = await app.inject({
    method: "POST",
    url: "/api/runtime/execute",
    headers,
    payload: {
      workspaceId: bootstrap.workspace.id,
      title: "Ollama live execution",
      objective:
        "Inspect the workspace and respond as JeanBot. Confirm the provider name and model in one concise paragraph.",
      capability: "reasoning",
      provider: "ollama",
      model: ollamaModel,
      mode: "live"
    }
  });

  if (executeResponse.statusCode !== 200) {
    throw new Error(`Runtime execute failed: ${executeResponse.body}`);
  }

  const runtime = executeResponse.json() as RuntimeExecuteResponse;

  const sessionsResponse = await app.inject({
    method: "GET",
    url: `/api/runtime/sessions?workspaceId=${bootstrap.workspace.id}`,
    headers
  });
  if (sessionsResponse.statusCode !== 200) {
    throw new Error(`Runtime session listing failed: ${sessionsResponse.body}`);
  }

  const sessions = sessionsResponse.json() as RuntimeSessionResponse[];
  const latestSession = [...sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )[0];
  if (!latestSession) {
    throw new Error("Runtime execution completed, but no runtime session was persisted.");
  }

  const sessionResponse = await app.inject({
    method: "GET",
    url: `/api/runtime/sessions/${latestSession.id}`,
    headers
  });
  if (sessionResponse.statusCode !== 200) {
    throw new Error(`Runtime session lookup failed: ${sessionResponse.body}`);
  }

  const sessionDetail = sessionResponse.json() as RuntimeSessionDetailResponse;

  const report = {
    generatedAt: new Date().toISOString(),
    jeanbot: {
      authRequired: process.env.JEANBOT_AUTH_REQUIRED,
      preferredProvider: process.env.JEANBOT_MODEL_PROVIDER,
      bootstrap,
      runtimeProviders: providerStatus,
      runtimeExecution: {
        provider: runtime.provider,
        model: runtime.model,
        mode: runtime.mode,
        promptDigest: runtime.promptDigest,
        finalText: runtime.finalText
      },
      session: {
        id: latestSession.id,
        workspaceId: latestSession.workspaceId,
        createdAt: latestSession.createdAt,
        updatedAt: latestSession.updatedAt,
        iterations: sessionDetail.iterations.length,
        providerResponses: sessionDetail.providerResponses
      }
    },
    ollama: daemonProbe,
    commands: {
      runtimeProviders:
        `curl.exe http://localhost:3000/api/runtime/providers -H "x-api-key: ${bootstrap.rawApiKey}"`,
      runtimeExecute:
        `curl.exe -X POST http://localhost:3000/api/runtime/execute -H "content-type: application/json" -H "x-api-key: ${bootstrap.rawApiKey}" -d "{\\"workspaceId\\":\\"${bootstrap.workspace.id}\\",\\"title\\":\\"Ollama live probe\\",\\"objective\\":\\"Say hello and confirm the runtime provider and model.\\",\\"capability\\":\\"reasoning\\",\\"provider\\":\\"ollama\\",\\"model\\":\\"${ollamaModel}\\",\\"mode\\":\\"live\\"}"`,
      runtimeSession:
        `curl.exe http://localhost:3000/api/runtime/sessions/${latestSession.id} -H "x-api-key: ${bootstrap.rawApiKey}"`
    }
  };

  await mkdir(path.dirname(defaultReportPath), {
    recursive: true
  });
  await writeFile(defaultReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await app.close();

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report written to ${defaultReportPath}`);
};

await run();
