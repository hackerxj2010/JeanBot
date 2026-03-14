import { describe, expect, it } from "vitest";

import { AdminService } from "../../services/admin-service/src/index.js";
import { UserService } from "../../services/user-service/src/index.js";

describe("AdminService", () => {
  it("lists tenants and persists quota overrides", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";

    const userService = new UserService();
    const adminService = new AdminService();
    const suffix = Date.now().toString();
    const bootstrapped = await userService.bootstrap({
      tenantName: "Admin Tenant",
      tenantSlug: `admin-tenant-${suffix}`,
      email: `admin-${suffix}@example.com`,
      displayName: "Admin User",
      workspaceName: "Admin Workspace",
      workspaceSlug: `admin-workspace-${suffix}`
    });

    const tenants = await adminService.listTenants();
    expect(tenants.some((entry) => entry.tenant.id === bootstrapped.tenant.id)).toBe(true);

    const updated = await adminService.updateWorkspaceQuotaOverride({
      workspaceId: bootstrapped.workspace.id,
      tenantId: bootstrapped.tenant.id,
      limits: {
        terminalSeconds: 12_345
      },
      reason: "Emergency allowance",
      updatedBy: bootstrapped.user.id
    });

    expect(updated.override.limits.terminalSeconds).toBe(12_345);
    expect(updated.quota.limits.terminalSeconds).toBe(12_345);

    const override = await adminService.getWorkspaceQuotaOverride(bootstrapped.workspace.id);
    expect(override?.reason).toBe("Emergency allowance");
  });
});
