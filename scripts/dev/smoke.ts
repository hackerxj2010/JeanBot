import { buildApp } from "../../services/api-gateway/src/app.js";

process.env.JEANBOT_AUTH_REQUIRED = "true";
process.env.JEANBOT_MODEL_PROVIDER = "";
process.env.OLLAMA_API_KEY = "";

const { app } = buildApp();

const suffix = Date.now().toString();
const bootstrapResponse = await app.inject({
  method: "POST",
  url: "/api/bootstrap",
  payload: {
    tenantName: "Smoke Tenant",
    tenantSlug: `smoke-tenant-${suffix}`,
    email: `smoke-${suffix}@example.com`,
    displayName: "Smoke Runner",
    workspaceName: "Smoke Workspace",
    workspaceSlug: `smoke-workspace-${suffix}`,
    apiKeyLabel: "smoke-key"
  }
});

if (bootstrapResponse.statusCode !== 200) {
  throw new Error(`Bootstrap failed: ${bootstrapResponse.body}`);
}

const bootstrap = bootstrapResponse.json();
const headers = {
  "x-api-key": bootstrap.rawApiKey
};

const runtimeProvidersResponse = await app.inject({
  method: "GET",
  url: "/api/runtime/providers",
  headers
});

if (runtimeProvidersResponse.statusCode !== 200) {
  throw new Error(`Runtime provider status failed: ${runtimeProvidersResponse.body}`);
}

const runtimeExecuteResponse = await app.inject({
  method: "POST",
  url: "/api/runtime/execute",
  headers,
  payload: {
    workspaceId: bootstrap.workspace.id,
    title: "Smoke runtime execution",
    objective: "Inspect the workspace and return a concise backend execution summary.",
    capability: "filesystem",
    mode: "synthetic"
  }
});

if (runtimeExecuteResponse.statusCode !== 200) {
  throw new Error(`Runtime execute failed: ${runtimeExecuteResponse.body}`);
}

const runtimeExecution = runtimeExecuteResponse.json();

const createMissionResponse = await app.inject({
  method: "POST",
  url: "/api/missions",
  headers,
  payload: {
    workspaceId: bootstrap.workspace.id,
    userId: bootstrap.user.id,
    title: "Smoke test",
    objective: "Run a JeanBot backend smoke test mission with an approval gate.",
    context: "Local verification",
    constraints: [],
    requiredCapabilities: ["planning", "filesystem", "memory", "finance", "orchestration"],
    risk: "medium"
  }
});

if (createMissionResponse.statusCode !== 200) {
  throw new Error(`Mission creation failed: ${createMissionResponse.body}`);
}

const mission = createMissionResponse.json();
const plannedResponse = await app.inject({
  method: "POST",
  url: `/api/missions/${mission.objective.id}/plan`,
  headers
});

if (plannedResponse.statusCode !== 200) {
  throw new Error(`Mission planning failed: ${plannedResponse.body}`);
}

const planned = plannedResponse.json();
const missionExecutionResponse = await app.inject({
  method: "GET",
  url: `/api/missions/${mission.objective.id}/execution`,
  headers
});

if (missionExecutionResponse.statusCode !== 200) {
  throw new Error(`Mission execution telemetry failed: ${missionExecutionResponse.body}`);
}

const missionExecution = missionExecutionResponse.json();
const approval = planned.approvals?.find((candidate: { status: string }) => candidate.status === "pending");
if (approval) {
  const approvalResponse = await app.inject({
    method: "POST",
    url: `/api/missions/${mission.objective.id}/approvals/${approval.id}/approve`,
    headers
  });

  if (approvalResponse.statusCode !== 200) {
    throw new Error(`Mission approval failed: ${approvalResponse.body}`);
  }
}

const runResponse = await app.inject({
  method: "POST",
  url: `/api/missions/${mission.objective.id}/run`,
  headers,
  payload: {
    workspaceRoot: "./workspace/users/{userId}"
  }
});

if (runResponse.statusCode !== 200) {
  throw new Error(`Mission execution failed: ${runResponse.body}`);
}

const executed = runResponse.json();

const notificationsResponse = await app.inject({
  method: "GET",
  url: `/api/workspaces/${bootstrap.workspace.id}/notifications`,
  headers
});

if (notificationsResponse.statusCode !== 200) {
  throw new Error(`Notifications listing failed: ${notificationsResponse.body}`);
}

const knowledgeIngestResponse = await app.inject({
  method: "POST",
  url: `/api/workspaces/${bootstrap.workspace.id}/knowledge`,
  headers,
  payload: {
    title: "Smoke knowledge",
    body: "JeanBot exposes knowledge, communication, and billing APIs through the gateway.",
    metadata: {
      source: "smoke"
    }
  }
});

if (knowledgeIngestResponse.statusCode !== 200) {
  throw new Error(`Knowledge ingest failed: ${knowledgeIngestResponse.body}`);
}

const communicationDraftResponse = await app.inject({
  method: "POST",
  url: `/api/workspaces/${bootstrap.workspace.id}/communication/draft`,
  headers,
  payload: {
    channel: "email",
    target: "smoke@example.com",
    subject: "Smoke draft",
    body: "JeanBot draft communication smoke check."
  }
});

if (communicationDraftResponse.statusCode !== 200) {
  throw new Error(`Communication draft failed: ${communicationDraftResponse.body}`);
}

const browserNavigateResponse = await app.inject({
  method: "POST",
  url: "/api/browser/navigate",
  headers,
  payload: {
    workspaceId: bootstrap.workspace.id,
    url: "https://example.com"
  }
});

if (browserNavigateResponse.statusCode !== 200) {
  throw new Error(`Browser navigation failed: ${browserNavigateResponse.body}`);
}

const browserSession = browserNavigateResponse.json();

const browserCaptureResponse = await app.inject({
  method: "POST",
  url: "/api/browser/capture",
  headers,
  payload: {
    sessionId: browserSession.id,
    workspaceId: bootstrap.workspace.id,
    fullPage: true
  }
});

if (browserCaptureResponse.statusCode !== 200) {
  throw new Error(`Browser capture failed: ${browserCaptureResponse.body}`);
}

const terminalRunResponse = await app.inject({
  method: "POST",
  url: "/api/terminal/run",
  headers,
  payload: {
    workspaceId: bootstrap.workspace.id,
    command: "echo JeanBot terminal smoke",
    cwd: "."
  }
});

if (terminalRunResponse.statusCode !== 200) {
  throw new Error(`Terminal run failed: ${terminalRunResponse.body}`);
}

const billingSummaryResponse = await app.inject({
  method: "GET",
  url: `/api/workspaces/${bootstrap.workspace.id}/billing`,
  headers
});

if (billingSummaryResponse.statusCode !== 200) {
  throw new Error(`Billing summary failed: ${billingSummaryResponse.body}`);
}

const heartbeatCreateResponse = await app.inject({
  method: "POST",
  url: "/api/heartbeats",
  headers,
  payload: {
    workspaceId: bootstrap.workspace.id,
    name: "Smoke heartbeat",
    schedule: "0 * * * *",
    objective: "Summarize workspace health during the smoke test.",
    active: true
  }
});

if (heartbeatCreateResponse.statusCode !== 200) {
  throw new Error(`Heartbeat creation failed: ${heartbeatCreateResponse.body}`);
}

const heartbeat = heartbeatCreateResponse.json();

const heartbeatTriggerResponse = await app.inject({
  method: "POST",
  url: `/api/heartbeats/${heartbeat.id}/trigger`,
  headers
});

if (heartbeatTriggerResponse.statusCode !== 200) {
  throw new Error(`Heartbeat trigger failed: ${heartbeatTriggerResponse.body}`);
}

const heartbeatHistoryResponse = await app.inject({
  method: "GET",
  url: `/api/heartbeats/${heartbeat.id}/history`,
  headers
});

if (heartbeatHistoryResponse.statusCode !== 200) {
  throw new Error(`Heartbeat history failed: ${heartbeatHistoryResponse.body}`);
}

const adminQuotaOverrideResponse = await app.inject({
  method: "PUT",
  url: `/api/admin/workspaces/${bootstrap.workspace.id}/quota-override`,
  headers,
  payload: {
    limits: {
      automations: 5
    },
    reason: "smoke override"
  }
});

if (adminQuotaOverrideResponse.statusCode !== 200) {
  throw new Error(`Admin quota override failed: ${adminQuotaOverrideResponse.body}`);
}

const quotaResponse = await app.inject({
  method: "GET",
  url: `/api/workspaces/${bootstrap.workspace.id}/quota`,
  headers
});

if (quotaResponse.statusCode !== 200) {
  throw new Error(`Quota status failed: ${quotaResponse.body}`);
}

const finalMissionResponse = await app.inject({
  method: "GET",
  url: `/api/missions/${mission.objective.id}`,
  headers
});

await app.close();

console.log(
  JSON.stringify(
    {
      missionId: mission.objective.id,
      status: executed.status,
      finalStatus: finalMissionResponse.json().status,
      missionExecutionMode: missionExecution.executionMode,
      plannedSteps: missionExecution.summary.totalSteps,
      approvals: planned.approvals?.length ?? 0,
      knowledgeDocuments: 1,
      draftedMessages: 1,
      notifications: notificationsResponse.json().length,
      runtimeMode: runtimeExecution.mode,
      runtimeProvider: runtimeExecution.provider,
      browserMode: browserSession.mode,
      terminalStatus: terminalRunResponse.json().record.status,
      heartbeatExecutions: heartbeatHistoryResponse.json().length,
      billingPlan: billingSummaryResponse.json().plan.id,
      quotaOverrideApplied: adminQuotaOverrideResponse.json().quota.overrideApplied,
      liveProviders: runtimeProvidersResponse.json().liveProviders,
      remainingAutomations: quotaResponse.json().remaining.automations
    },
    null,
    2
  )
);
