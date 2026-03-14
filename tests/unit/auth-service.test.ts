import { describe, expect, it } from "vitest";

import { AuthService } from "../../services/auth-service/src/index.js";
import { UserService } from "../../services/user-service/src/index.js";

describe("AuthService", () => {
  it("recomputes session permissions from updated memberships and roles", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    const suffix = `${Date.now()}-auth`;
    const userService = new UserService();
    const authService = new AuthService();

    const bootstrap = await userService.bootstrap({
      tenantName: "Auth Tenant",
      tenantSlug: `auth-tenant-${suffix}`,
      email: `auth-${suffix}@example.com`,
      displayName: "Auth User",
      workspaceName: "Auth Workspace",
      workspaceSlug: `auth-workspace-${suffix}`
    });

    const apiKey = await authService.createApiKey({
      tenantId: bootstrap.tenant.id,
      userId: bootstrap.user.id,
      workspaceIds: [bootstrap.workspace.id],
      label: "auth-key"
    });

    const exchanged = await authService.exchangeApiKey(apiKey.rawKey);
    expect(exchanged).toBeDefined();
    expect(exchanged?.authContext.permissions).not.toContain("reports:read");
    if (!exchanged) {
      throw new Error("Expected API key exchange to create a session.");
    }

    const customRole = await authService.createRole({
      tenantId: bootstrap.tenant.id,
      name: `Auditor ${suffix}`,
      permissions: ["reports:read", "audit:read"]
    });

    await userService.updateMembershipRoles(bootstrap.membership.id, ["admin", customRole.id]);

    const verified = await authService.verifyAccessToken(exchanged.accessToken);
    expect(verified?.authContext.permissions).toContain("reports:read");

    const refreshed = await authService.refreshSession(exchanged.refreshToken);
    expect(refreshed?.authContext.permissions).toContain("reports:read");
  });

  it("supports synthetic Gmail and GitHub OAuth flows", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    process.env.GOOGLE_CLIENT_ID = undefined;
    process.env.GOOGLE_CLIENT_SECRET = undefined;
    process.env.GITHUB_CLIENT_ID = undefined;
    process.env.GITHUB_CLIENT_SECRET = undefined;

    const suffix = `${Date.now()}-oauth`;
    const userService = new UserService();
    const authService = new AuthService();

    const bootstrap = await userService.bootstrap({
      tenantName: "OAuth Tenant",
      tenantSlug: `oauth-tenant-${suffix}`,
      email: `oauth-${suffix}@example.com`,
      displayName: "OAuth User",
      workspaceName: "OAuth Workspace",
      workspaceSlug: `oauth-workspace-${suffix}`
    });

    const authContext = {
      tenantId: bootstrap.tenant.id,
      userId: bootstrap.user.id,
      workspaceIds: [bootstrap.workspace.id],
      roleIds: ["admin"],
      permissions: ["tools:use"],
      subjectType: "user" as const
    };

    const gmail = await authService.startOAuth(
      {
        workspaceId: bootstrap.workspace.id,
        provider: "gmail",
        redirectUri: "https://app.jeanbot.local/oauth/callback"
      },
      authContext
    );

    const connectedGmail = await authService.completeOAuth(
      {
        workspaceId: bootstrap.workspace.id,
        provider: "gmail",
        code: "synthetic_gmail_unit",
        state: gmail.state,
        redirectUri: "https://app.jeanbot.local/oauth/callback"
      },
      authContext
    );

    expect(connectedGmail.provider).toBe("gmail");
    expect(connectedGmail.status).toBe("connected");
    expect(connectedGmail.encryptedAccessToken).toBeUndefined();

    const github = await authService.startOAuth(
      {
        workspaceId: bootstrap.workspace.id,
        provider: "github",
        redirectUri: "https://app.jeanbot.local/oauth/callback"
      },
      authContext
    );

    await authService.completeOAuth(
      {
        workspaceId: bootstrap.workspace.id,
        provider: "github",
        code: "synthetic_github_unit",
        state: github.state,
        redirectUri: "https://app.jeanbot.local/oauth/callback"
      },
      authContext
    );

    const integrations = await authService.listIntegrations(bootstrap.workspace.id);
    expect(integrations.map((record) => record.provider).sort()).toEqual(["github", "gmail"]);

    await expect(
      authService.disconnectIntegration(bootstrap.workspace.id, "gmail", authContext)
    ).resolves.toBe(true);
  });
});
