import { describe, expect, it } from "vitest";

import { NotificationService } from "../../services/notification-service/src/index.js";
import { UserService } from "../../services/user-service/src/index.js";

describe("NotificationService", () => {
  it("stores email and push notifications for completed tasks", async () => {
    process.env.JEANBOT_PERSISTENCE_MODE = "local";
    delete process.env.PUSH_GATEWAY_URL;

    const userService = new UserService();
    const notificationService = new NotificationService();
    const suffix = Date.now().toString();
    const bootstrapped = await userService.bootstrap({
      tenantName: "Notification Tenant",
      tenantSlug: `notification-tenant-${suffix}`,
      email: `notify-${suffix}@example.com`,
      displayName: "Notification User",
      workspaceName: "Notification Workspace",
      workspaceSlug: `notification-workspace-${suffix}`
    });

    const notifications = await notificationService.notifyUserTaskCompletion({
      workspaceId: bootstrapped.workspace.id,
      userId: bootstrapped.user.id,
      eventType: "mission.completed",
      subject: "JeanBot mission completed",
      body: "Your task finished successfully."
    });

    expect(notifications).toHaveLength(2);
    expect(notifications.some((record) => record.channel === "email")).toBe(true);
    expect(notifications.some((record) => record.channel === "push")).toBe(true);
    expect(notifications.every((record) => record.status === "sent")).toBe(true);

    const listed = await notificationService.listNotifications(
      bootstrapped.workspace.id,
      bootstrapped.user.id
    );
    expect(listed.length).toBeGreaterThanOrEqual(2);
  });
});
