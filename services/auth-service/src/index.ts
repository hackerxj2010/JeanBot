import crypto from "node:crypto";

import Fastify from "fastify";
import { google } from "googleapis";

import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import {
  apiKeyPreview,
  assertInternalRequest,
  assertWorkspaceAccess,
  authContextFromHeaders,
  createApiKeyValue,
  hashApiKey,
  loadPlatformConfig
} from "@jeanbot/platform";
import { encryptSecret } from "@jeanbot/security";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration } from "@jeanbot/telemetry";
import type {
  ApiKeyRecord,
  AuthSessionRecord,
  ConnectedIntegrationRecord,
  IntegrationProvider,
  OAuthCallbackRequest,
  OAuthStartRequest,
  OAuthStartResponse,
  RoleRecord,
  ServiceAuthContext,
  ServiceHealth
} from "@jeanbot/types";

const builtInRolePermissions: Record<string, string[]> = {
  admin: [
    "admin:manage",
    "missions:read",
    "missions:write",
    "missions:execute",
    "missions:approve",
    "audit:read",
    "tools:use",
    "heartbeats:manage",
    "apikeys:manage",
    "workspaces:manage",
    "knowledge:read",
    "knowledge:write",
    "communication:read",
    "communication:send",
    "billing:read"
  ],
  operator: [
    "missions:read",
    "missions:write",
    "missions:execute",
    "audit:read",
    "tools:use",
    "heartbeats:manage",
    "knowledge:read",
    "knowledge:write",
    "communication:read",
    "communication:send",
    "billing:read"
  ],
  viewer: [
    "missions:read",
    "audit:read",
    "knowledge:read",
    "communication:read",
    "billing:read"
  ]
};

const builtInRoles = (tenantId: string): RoleRecord[] =>
  Object.entries(builtInRolePermissions).map(([name, permissions]) => ({
    id: name,
    tenantId,
    name,
    permissions,
    system: true
  }));

const createOpaqueToken = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(24).toString("hex")}`;

const oauthScopes: Record<IntegrationProvider, string[]> = {
  gmail: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send"
  ],
  github: ["repo", "read:user", "user:email"]
};

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();

const isExpired = (timestamp: string) => new Date(timestamp).getTime() <= Date.now();

export class AuthService {
  private readonly logger = createLogger("auth-service");
  private readonly persistence = createPersistenceBundle();
  private readonly config = loadPlatformConfig();

  private async resolveRoles(tenantId: string, roleIds: string[]) {
    const customRoles = await this.persistence.identity.listRoles(tenantId);
    const byId = new Map([...builtInRoles(tenantId), ...customRoles].map((role) => [role.id, role]));
    return [...new Set(roleIds)]
      .map((roleId) => byId.get(roleId))
      .filter((role): role is RoleRecord => Boolean(role));
  }

  private async buildAuthContext(
    tenantId: string,
    userId: string,
    workspaceIds?: string[]
  ): Promise<ServiceAuthContext> {
    const memberships = await this.persistence.identity.listMembershipsForUser(tenantId, userId);
    const authorizedMemberships = workspaceIds
      ? memberships.filter((membership) => workspaceIds.includes(membership.workspaceId))
      : memberships;
    const roleIds = [...new Set(authorizedMemberships.flatMap((membership) => membership.roleIds))];
    const roles = await this.resolveRoles(tenantId, roleIds);
    const permissions = [...new Set(roles.flatMap((role) => role.permissions))];

    return {
      tenantId,
      userId,
      workspaceIds: workspaceIds ?? [...new Set(authorizedMemberships.map((membership) => membership.workspaceId))],
      roleIds,
      permissions,
      subjectType: "user"
    };
  }

  private async createSession(authContext: ServiceAuthContext) {
    const accessToken = createOpaqueToken("jean_access");
    const refreshToken = createOpaqueToken("jean_refresh");
    const session = await this.persistence.identity.createSession({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      workspaceIds: authContext.workspaceIds,
      roleIds: authContext.roleIds,
      permissions: authContext.permissions,
      subjectType: authContext.subjectType,
      accessTokenHash: hashApiKey(accessToken),
      refreshTokenHash: hashApiKey(refreshToken),
      accessExpiresAt: minutesFromNow(15),
      refreshExpiresAt: daysFromNow(30),
      lastUsedAt: undefined,
      revokedAt: undefined
    });

    this.logger.info("Created auth session", {
      sessionId: session.id,
      tenantId: authContext.tenantId,
      userId: authContext.userId
    });

    return {
      session,
      accessToken,
      refreshToken
    };
  }

  private async authContextFromSession(session: AuthSessionRecord): Promise<ServiceAuthContext> {
    if (session.subjectType === "service") {
      return this.toAuthContext(session);
    }

    const authContext = await this.buildAuthContext(
      session.tenantId,
      session.userId,
      session.workspaceIds
    );

    return {
      ...authContext,
      subjectType: session.subjectType
    };
  }

  async createApiKey(input: {
    tenantId: string;
    userId: string;
    workspaceIds: string[];
    label: string;
  }) {
    const rawKey = createApiKeyValue();
    const record = await this.persistence.identity.createApiKey({
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceIds: input.workspaceIds,
      label: input.label,
      hashedKey: hashApiKey(rawKey),
      preview: apiKeyPreview(rawKey),
      active: true,
      lastUsedAt: undefined
    });

    this.logger.info("Created API key", {
      apiKeyId: record.id,
      tenantId: input.tenantId,
      userId: input.userId
    });

    return {
      record,
      rawKey
    };
  }

  async verifyApiKey(
    rawKey: string
  ): Promise<{ apiKey: ApiKeyRecord; authContext: ServiceAuthContext } | undefined> {
    const apiKey = await this.persistence.identity.findApiKeyByHash(hashApiKey(rawKey));
    if (!apiKey || !apiKey.active) {
      return undefined;
    }

    const authContext = await this.buildAuthContext(
      apiKey.tenantId,
      apiKey.userId,
      apiKey.workspaceIds
    );

    return {
      apiKey,
      authContext: {
        ...authContext,
        apiKeyId: apiKey.id
      }
    };
  }

  async exchangeApiKey(rawKey: string) {
    const verified = await this.verifyApiKey(rawKey);
    if (!verified) {
      return undefined;
    }

    const issued = await this.createSession(verified.authContext);
    return {
      ...issued,
      authContext: verified.authContext
    };
  }

  async verifyAccessToken(rawToken: string) {
    const session = await this.persistence.identity.findSessionByAccessHash(hashApiKey(rawToken));
    if (!session || session.revokedAt || isExpired(session.accessExpiresAt)) {
      return undefined;
    }

    await this.persistence.identity.touchSession(session.id, new Date().toISOString());
    const authContext = await this.authContextFromSession(session);
    return {
      session,
      authContext
    };
  }

  async refreshSession(rawRefreshToken: string) {
    const session = await this.persistence.identity.findSessionByRefreshHash(hashApiKey(rawRefreshToken));
    if (!session || session.revokedAt || isExpired(session.refreshExpiresAt)) {
      return undefined;
    }

    const authContext = await this.authContextFromSession(session);
    const accessToken = createOpaqueToken("jean_access");
    const refreshToken = createOpaqueToken("jean_refresh");
    await this.persistence.identity.revokeSession(session.id, new Date().toISOString());
    const next = await this.persistence.identity.createSession({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      workspaceIds: authContext.workspaceIds,
      roleIds: authContext.roleIds,
      permissions: authContext.permissions,
      subjectType: authContext.subjectType,
      accessTokenHash: hashApiKey(accessToken),
      refreshTokenHash: hashApiKey(refreshToken),
      accessExpiresAt: minutesFromNow(15),
      refreshExpiresAt: daysFromNow(30),
      lastUsedAt: undefined,
      revokedAt: undefined
    });

    return {
      session: next,
      accessToken,
      refreshToken,
      authContext
    };
  }

  async listApiKeys(tenantId: string) {
    return this.persistence.identity.listApiKeys(tenantId);
  }

  async listRoles(tenantId: string) {
    const customRoles = await this.persistence.identity.listRoles(tenantId);
    return [...builtInRoles(tenantId), ...customRoles];
  }

  async createRole(input: {
    tenantId: string;
    name: string;
    permissions: string[];
  }) {
    return this.persistence.identity.createRole({
      tenantId: input.tenantId,
      name: input.name,
      permissions: [...new Set(input.permissions)],
      system: false,
      createdAt: new Date().toISOString()
    });
  }

  private signOAuthState(payload: {
    workspaceId: string;
    provider: IntegrationProvider;
    redirectUri: string;
    userId?: string | undefined;
    tenantId?: string | undefined;
    expiresAt: string;
  }) {
    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", this.config.internalServiceToken)
      .update(body)
      .digest("hex");
    return `${Buffer.from(body, "utf8").toString("base64url")}.${signature}`;
  }

  private verifyOAuthState(
    state: string,
    expected: Pick<OAuthCallbackRequest, "workspaceId" | "provider" | "redirectUri">
  ) {
    const [encoded, signature] = state.split(".");
    if (!encoded || !signature) {
      throw new Error("Invalid OAuth state format.");
    }

    const body = Buffer.from(encoded, "base64url").toString("utf8");
    const expectedSignature = crypto
      .createHmac("sha256", this.config.internalServiceToken)
      .update(body)
      .digest("hex");
    if (signature !== expectedSignature) {
      throw new Error("OAuth state signature mismatch.");
    }

    const payload = JSON.parse(body) as {
      workspaceId: string;
      provider: IntegrationProvider;
      redirectUri: string;
      userId?: string | undefined;
      tenantId?: string | undefined;
      expiresAt: string;
    };

    if (isExpired(payload.expiresAt)) {
      throw new Error("OAuth state has expired.");
    }

    if (
      payload.workspaceId !== expected.workspaceId ||
      payload.provider !== expected.provider ||
      payload.redirectUri !== expected.redirectUri
    ) {
      throw new Error("OAuth state did not match the callback target.");
    }

    return payload;
  }

  private providerCredentials(provider: IntegrationProvider) {
    if (provider === "gmail") {
      return {
        clientId: this.config.googleClientId,
        clientSecret: this.config.googleClientSecret
      };
    }

    return {
      clientId: this.config.githubClientId,
      clientSecret: this.config.githubClientSecret
    };
  }

  private sanitizeIntegration(record: ConnectedIntegrationRecord) {
    return {
      ...record,
      encryptedAccessToken: undefined,
      encryptedRefreshToken: undefined
    } satisfies ConnectedIntegrationRecord;
  }

  async listIntegrations(workspaceId: string) {
    const records = await this.persistence.integrations.list(workspaceId);
    return records.map((record) => this.sanitizeIntegration(record));
  }

  async startOAuth(
    input: OAuthStartRequest,
    authContext?: ServiceAuthContext
  ): Promise<OAuthStartResponse> {
    assertWorkspaceAccess(authContext, input.workspaceId);
    const state = this.signOAuthState({
      workspaceId: input.workspaceId,
      provider: input.provider,
      redirectUri: input.redirectUri,
      userId: authContext?.userId,
      tenantId: authContext?.tenantId,
      expiresAt: minutesFromNow(10)
    });
    const credentials = this.providerCredentials(input.provider);
    const now = new Date().toISOString();
    await this.persistence.integrations.save({
      id: crypto.randomUUID(),
      tenantId: authContext?.tenantId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      status: "pending",
      scopes: oauthScopes[input.provider],
      metadata: {
        redirectUri: input.redirectUri,
        mode: credentials.clientId && credentials.clientSecret ? "live" : "synthetic"
      },
      connectedAt: now,
      updatedAt: now
    });

    if (!credentials.clientId || !credentials.clientSecret) {
      const syntheticCode = `synthetic_${input.provider}_${crypto.randomUUID()}`;
      const callback = new URL(input.redirectUri);
      callback.searchParams.set("state", state);
      callback.searchParams.set("code", syntheticCode);
      callback.searchParams.set("provider", input.provider);
      callback.searchParams.set("workspaceId", input.workspaceId);
      return {
        provider: input.provider,
        authorizationUrl: callback.toString(),
        state
      };
    }

    if (input.provider === "gmail") {
      const client = new google.auth.OAuth2(
        credentials.clientId,
        credentials.clientSecret,
        input.redirectUri
      );
      return {
        provider: input.provider,
        authorizationUrl: client.generateAuthUrl({
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: true,
          scope: oauthScopes.gmail,
          state
        }),
        state
      };
    }

    const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
    authorizationUrl.searchParams.set("client_id", credentials.clientId);
    authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
    authorizationUrl.searchParams.set("scope", oauthScopes.github.join(" "));
    authorizationUrl.searchParams.set("state", state);

    return {
      provider: input.provider,
      authorizationUrl: authorizationUrl.toString(),
      state
    };
  }

  private async exchangeGoogleCode(input: OAuthCallbackRequest) {
    const client = new google.auth.OAuth2(
      this.config.googleClientId,
      this.config.googleClientSecret,
      input.redirectUri
    );
    const tokenResponse = await client.getToken(input.code);
    const credentials = tokenResponse.tokens;
    if (!credentials.access_token) {
      throw new Error("Google OAuth callback did not return an access token.");
    }

    const identityResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        authorization: `Bearer ${credentials.access_token}`
      }
    });
    if (!identityResponse.ok) {
      throw new Error(`Google userinfo request failed with status ${identityResponse.status}.`);
    }

    const identity = (await identityResponse.json()) as {
      id?: string;
      email?: string;
    };

    return {
      providerAccountId: identity.email ?? identity.id ?? "google-user",
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? undefined,
      expiresAt:
        typeof credentials.expiry_date === "number"
          ? new Date(credentials.expiry_date).toISOString()
          : undefined,
      scopes:
        typeof credentials.scope === "string"
          ? credentials.scope.split(/\s+/).filter(Boolean)
          : oauthScopes.gmail,
      metadata: {
        mode: "live",
        email: identity.email
      }
    };
  }

  private async exchangeGitHubCode(input: OAuthCallbackRequest) {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        client_id: this.config.githubClientId,
        client_secret: this.config.githubClientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        state: input.state
      })
    });
    if (!tokenResponse.ok) {
      throw new Error(`GitHub token exchange failed with status ${tokenResponse.status}.`);
    }

    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
      refresh_token?: string;
    };
    if (!tokenBody.access_token) {
      throw new Error("GitHub OAuth callback did not return an access token.");
    }

    const identityResponse = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        "user-agent": "jeanbot-auth-service",
        accept: "application/vnd.github+json"
      }
    });
    if (!identityResponse.ok) {
      throw new Error(`GitHub user lookup failed with status ${identityResponse.status}.`);
    }

    const identity = (await identityResponse.json()) as {
      id?: number;
      login?: string;
    };

    return {
      providerAccountId: identity.login ?? String(identity.id ?? "github-user"),
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token ?? undefined,
      expiresAt: undefined,
      scopes: tokenBody.scope?.split(",").filter(Boolean) ?? oauthScopes.github,
      metadata: {
        mode: "live",
        login: identity.login
      }
    };
  }

  async completeOAuth(
    input: OAuthCallbackRequest,
    authContext?: ServiceAuthContext
  ) {
    assertWorkspaceAccess(authContext, input.workspaceId);
    const state = this.verifyOAuthState(input.state, input);
    const credentials = this.providerCredentials(input.provider);
    const synthetic =
      input.code.startsWith("synthetic_") || !credentials.clientId || !credentials.clientSecret;

    const providerResult = synthetic
      ? {
          providerAccountId: `synthetic-${input.provider}`,
          accessToken: `synthetic-access-${input.provider}-${crypto.randomUUID()}`,
          refreshToken: `synthetic-refresh-${input.provider}-${crypto.randomUUID()}`,
          expiresAt: daysFromNow(30),
          scopes: oauthScopes[input.provider],
          metadata: {
            mode: "synthetic"
          }
        }
      : input.provider === "gmail"
        ? await this.exchangeGoogleCode(input)
        : await this.exchangeGitHubCode(input);

    const now = new Date().toISOString();
    const record = await this.persistence.integrations.save({
      id: crypto.randomUUID(),
      tenantId: authContext?.tenantId ?? state.tenantId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      status: "connected",
      scopes: providerResult.scopes,
      providerAccountId: providerResult.providerAccountId,
      encryptedAccessToken: encryptSecret(
        providerResult.accessToken
      ),
      encryptedRefreshToken: providerResult.refreshToken
        ? encryptSecret(providerResult.refreshToken)
        : undefined,
      accessTokenExpiresAt: providerResult.expiresAt,
      metadata: {
        ...providerResult.metadata,
        redirectUri: input.redirectUri
      },
      connectedAt: now,
      updatedAt: now
    });

    this.logger.info("Workspace integration connected", {
      workspaceId: input.workspaceId,
      provider: input.provider,
      providerAccountId: record.providerAccountId
    });

    return this.sanitizeIntegration(record);
  }

  async disconnectIntegration(
    workspaceId: string,
    provider: IntegrationProvider,
    authContext?: ServiceAuthContext
  ) {
    assertWorkspaceAccess(authContext, workspaceId);
    return this.persistence.integrations.delete(workspaceId, provider);
  }

  private toAuthContext(session: AuthSessionRecord): ServiceAuthContext {
    return {
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceIds: session.workspaceIds,
      roleIds: session.roleIds,
      permissions: session.permissions,
      subjectType: session.subjectType
    };
  }

  health(): ServiceHealth {
    return {
      name: "auth-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode
      },
      readiness: {
        persistence: {
          ok: true,
          status: "ready",
          message: `Auth persistence is running in ${this.persistence.mode} mode.`
        },
        integrations: {
          ok: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GITHUB_CLIENT_ID),
          status:
            process.env.GOOGLE_CLIENT_ID && process.env.GITHUB_CLIENT_ID ? "ready" : "degraded",
          message:
            process.env.GOOGLE_CLIENT_ID && process.env.GITHUB_CLIENT_ID
              ? "OAuth client credentials are configured."
              : "OAuth client credentials are not fully configured yet."
        }
      },
      metricsPath: "/metrics"
    };
  }
}

export const buildAuthServiceApp = () => {
  const app = Fastify();
  const service = new AuthService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("auth-service");

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "auth-service",
      method: request.method,
      route,
      status: String(reply.statusCode)
    };
    recordCounter("jeanbot_http_server_requests_total", "JeanBot HTTP server requests", labels);
    recordDuration(
      "jeanbot_http_server_request_duration_ms",
      "JeanBot HTTP server request duration",
      Date.now() - startedAt,
      labels
    );
  });

  app.addHook("onError", async (request, _reply, error) => {
    captureException(error, {
      service: "auth-service",
      route: request.routeOptions.url ?? request.url.split("?")[0]
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: service.health()
  }));

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return metrics();
  });

  app.post("/internal/auth/api-keys", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.createApiKey(request.body as {
      tenantId: string;
      userId: string;
      workspaceIds: string[];
      label: string;
    });
  });

  app.post("/internal/auth/verify-key", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const body = request.body as { apiKey: string };
    const verified = await service.verifyApiKey(body.apiKey);
    return verified ? { ok: true, ...verified } : { ok: false };
  });

  app.post("/internal/auth/sessions/exchange-key", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const body = request.body as { apiKey: string };
    const issued = await service.exchangeApiKey(body.apiKey);
    return issued ? { ok: true, ...issued } : { ok: false };
  });

  app.post("/internal/auth/sessions/verify", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const body = request.body as { accessToken: string };
    const verified = await service.verifyAccessToken(body.accessToken);
    return verified ? { ok: true, ...verified } : { ok: false };
  });

  app.post("/internal/auth/sessions/refresh", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const body = request.body as { refreshToken: string };
    const refreshed = await service.refreshSession(body.refreshToken);
    return refreshed ? { ok: true, ...refreshed } : { ok: false };
  });

  app.get("/internal/auth/api-keys/:tenantId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { tenantId: string };
    return service.listApiKeys(params.tenantId);
  });

  app.get("/internal/auth/roles/:tenantId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { tenantId: string };
    return service.listRoles(params.tenantId);
  });

  app.post("/internal/auth/roles", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.createRole(request.body as {
      tenantId: string;
      name: string;
      permissions: string[];
    });
  });

  app.get("/internal/auth/workspaces/:workspaceId/integrations", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    assertWorkspaceAccess(authContext, params.workspaceId);
    return service.listIntegrations(params.workspaceId);
  });

  app.post("/internal/auth/workspaces/:workspaceId/integrations/:provider/connect", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string; provider: IntegrationProvider };
    const body = request.body as { redirectUri: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.startOAuth(
      {
        workspaceId: params.workspaceId,
        provider: params.provider,
        redirectUri: body.redirectUri
      },
      authContext
    );
  });

  app.post("/internal/auth/workspaces/:workspaceId/integrations/:provider/callback", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string; provider: IntegrationProvider };
    const body = request.body as { code: string; state: string; redirectUri: string };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return service.completeOAuth(
      {
        workspaceId: params.workspaceId,
        provider: params.provider,
        code: body.code,
        state: body.state,
        redirectUri: body.redirectUri
      },
      authContext
    );
  });

  app.delete("/internal/auth/workspaces/:workspaceId/integrations/:provider", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string; provider: IntegrationProvider };
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    return {
      ok: await service.disconnectIntegration(params.workspaceId, params.provider, authContext)
    };
  });

  return {
    app,
    service
  };
};
