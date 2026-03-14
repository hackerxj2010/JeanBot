import Fastify from "fastify";

import { createLogger } from "@jeanbot/logger";
import { createPersistenceBundle } from "@jeanbot/persistence";
import { assertInternalRequest, loadPlatformConfig } from "@jeanbot/platform";
import type { ServiceHealth } from "@jeanbot/types";

export class UserService {
  private readonly logger = createLogger("user-service");
  private readonly persistence = createPersistenceBundle();

  async bootstrap(input: {
    tenantName: string;
    tenantSlug: string;
    email: string;
    displayName: string;
    workspaceName: string;
    workspaceSlug: string;
  }) {
    const tenant = await this.persistence.identity.createTenant({
      name: input.tenantName,
      slug: input.tenantSlug
    });
    const user = await this.persistence.identity.createUser({
      tenantId: tenant.id,
      email: input.email,
      displayName: input.displayName
    });
    const workspace = await this.persistence.identity.createWorkspace({
      tenantId: tenant.id,
      name: input.workspaceName,
      slug: input.workspaceSlug
    });
    const membership = await this.persistence.identity.addMembership({
      tenantId: tenant.id,
      workspaceId: workspace.id,
      userId: user.id,
      roleIds: ["admin"]
    });

    this.logger.info("Bootstrapped tenant workspace", {
      tenantId: tenant.id,
      workspaceId: workspace.id,
      userId: user.id
    });

    return {
      tenant,
      user,
      workspace,
      membership
    };
  }

  async createWorkspace(input: {
    tenantId: string;
    userId: string;
    name: string;
    slug: string;
    roleIds?: string[] | undefined;
  }) {
    const workspace = await this.persistence.identity.createWorkspace({
      tenantId: input.tenantId,
      name: input.name,
      slug: input.slug
    });
    const membership = await this.persistence.identity.addMembership({
      tenantId: input.tenantId,
      workspaceId: workspace.id,
      userId: input.userId,
      roleIds: input.roleIds ?? ["admin"]
    });

    return {
      workspace,
      membership
    };
  }

  async listWorkspaces(tenantId: string, userId: string) {
    return this.persistence.identity.listWorkspacesForUser(tenantId, userId);
  }

  async listMemberships(workspaceId: string) {
    return this.persistence.identity.listMembershipsForWorkspace(workspaceId);
  }

  async addMembership(input: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    roleIds: string[];
  }) {
    return this.persistence.identity.addMembership({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      roleIds: [...new Set(input.roleIds)]
    });
  }

  async updateMembershipRoles(membershipId: string, roleIds: string[]) {
    return this.persistence.identity.updateMembershipRoles(membershipId, roleIds);
  }

  async resolveUserContext(input: {
    tenantSlug: string;
    email: string;
    workspaceSlug?: string | undefined;
  }) {
    const tenant = await this.persistence.identity.getTenantBySlug(input.tenantSlug);
    if (!tenant) {
      return undefined;
    }

    const user = await this.persistence.identity.getUserByEmail(tenant.id, input.email);
    if (!user) {
      return undefined;
    }

    const workspaces = await this.persistence.identity.listWorkspacesForUser(tenant.id, user.id);
    const workspace = input.workspaceSlug
      ? workspaces.find((candidate) => candidate.slug === input.workspaceSlug)
      : workspaces[0];

    return {
      tenant,
      user,
      workspace,
      workspaces
    };
  }

  health(): ServiceHealth {
    return {
      name: "user-service",
      ok: true,
      details: {
        persistenceMode: this.persistence.mode
      }
    };
  }
}

export const buildUserServiceApp = () => {
  const app = Fastify();
  const service = new UserService();
  const config = loadPlatformConfig();

  app.get("/health", async () => ({
    ok: true,
    service: service.health()
  }));

  app.post("/internal/users/bootstrap", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.bootstrap(request.body as {
      tenantName: string;
      tenantSlug: string;
      email: string;
      displayName: string;
      workspaceName: string;
      workspaceSlug: string;
    });
  });

  app.post("/internal/workspaces", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.createWorkspace(request.body as {
      tenantId: string;
      userId: string;
      name: string;
      slug: string;
      roleIds?: string[];
    });
  });

  app.get("/internal/users/:tenantId/:userId/workspaces", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { tenantId: string; userId: string };
    return service.listWorkspaces(params.tenantId, params.userId);
  });

  app.get("/internal/workspaces/:workspaceId/memberships", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    return service.listMemberships(params.workspaceId);
  });

  app.post("/internal/workspaces/:workspaceId/memberships", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { workspaceId: string };
    const body = request.body as { tenantId: string; userId: string; roleIds: string[] };
    return service.addMembership({
      tenantId: body.tenantId,
      workspaceId: params.workspaceId,
      userId: body.userId,
      roleIds: body.roleIds
    });
  });

  app.put("/internal/memberships/:membershipId/roles", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { membershipId: string };
    const body = request.body as { roleIds: string[] };
    return service.updateMembershipRoles(params.membershipId, body.roleIds);
  });

  app.post("/internal/users/resolve", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.resolveUserContext(request.body as {
      tenantSlug: string;
      email: string;
      workspaceSlug?: string;
    });
  });

  return {
    app,
    service
  };
};
