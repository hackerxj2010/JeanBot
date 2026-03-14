import { describe, expect, it } from "vitest";

import { BrowserService } from "../../services/browser-service/src/index.js";

describe("BrowserService", () => {
  it("tracks synthetic browser sessions, events, and captures", async () => {
    process.env.PLAYWRIGHT_LIVE = "false";

    const service = new BrowserService();
    const workspaceId = `browser-workspace-${Date.now()}`;

    const session = await service.navigate({
      workspaceId,
      url: "https://example.com",
      requestedBy: "browser-test"
    });

    expect(session.mode).toBe("synthetic");

    const extraction = await service.extract({
      sessionId: session.id,
      workspaceId,
      kind: "text",
      requestedBy: "browser-test"
    });

    expect(Array.isArray(extraction.output)).toBe(true);

    const capture = await service.capture({
      sessionId: session.id,
      workspaceId,
      fullPage: true,
      requestedBy: "browser-test"
    });

    expect(capture.path).toContain(workspaceId);

    const hydrated = await service.getSession(session.id);
    expect(hydrated?.events.length).toBeGreaterThanOrEqual(2);
    expect(hydrated?.captures.length).toBeGreaterThanOrEqual(1);

    const streamInfo = await service.getStreamInfo(session.id, workspaceId);
    expect(streamInfo.sessionId).toBe(session.id);
    expect(streamInfo.streamUrl).toContain(`/internal/browser/stream/${session.id}`);
    expect(streamInfo.token.length).toBeGreaterThan(10);
    expect(streamInfo.lastFrameAt).toBeDefined();

    await expect(service.closeSession(session.id, "browser-test")).resolves.toBe(true);
    await service.close();
  });
});
