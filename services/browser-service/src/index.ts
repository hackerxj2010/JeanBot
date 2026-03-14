import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { Browser, BrowserContext, Page } from "playwright";

import { AuditService } from "@jeanbot/audit-service";
import { LocalJsonStore, ensureDirectory } from "@jeanbot/documents";
import { createLogger } from "@jeanbot/logger";
import {
  assertInternalRequest,
  authContextFromHeaders,
  loadPlatformConfig
} from "@jeanbot/platform";
import { PolicyService } from "@jeanbot/policy-service";
import { captureException, initTelemetry, metrics, recordCounter, recordDuration, setGauge } from "@jeanbot/telemetry";
import type {
  BrowserActionRequest,
  BrowserCaptureRecord,
  BrowserCaptureRequest,
  BrowserEventRecord,
  BrowserExtractRequest,
  BrowserNavigateRequest,
  BrowserSessionMode,
  BrowserSessionSummary,
  BrowserStreamEvent,
  BrowserStreamInfo,
  ServiceHealth,
  ToolDescriptor
} from "@jeanbot/types";

const browserToolDescriptor: ToolDescriptor = {
  id: "browser.session.control",
  name: "Browser session controller",
  kind: "browser",
  description: "Controls browser navigation, interaction, extraction, and capture.",
  permissions: ["navigate", "interact", "extract", "capture"],
  requiresApproval: false
};

interface InternalBrowserSession {
  summary: BrowserSessionSummary;
  lease?: BrowserLease | undefined;
  browser?: Browser | undefined;
  context?: BrowserContext | undefined;
  page?: Page | undefined;
}

interface BrowserLease {
  browserId: string;
  browser: Browser;
}

interface BrowserExtractionResult {
  sessionId: string;
  workspaceId: string;
  kind: "text" | "links" | "html";
  mode: BrowserSessionMode;
  output: unknown;
}

interface BrowserStreamFrame {
  sequence: number;
  createdAt: string;
  mimeType: string;
  data: string;
}

type Subscriber = {
  send(payload: string): void;
  close(): void;
};

const FRAME_RATE = 2;
const FRAME_INTERVAL_MS = Math.round(1000 / FRAME_RATE);

class BrowserPool {
  private readonly logger = createLogger("browser-service.pool");
  private readonly warmPoolTarget = Number(process.env.BROWSER_POOL_WARM ?? 2);
  private readonly maxBrowsers = Number(process.env.BROWSER_POOL_MAX ?? 4);
  private readonly available: BrowserLease[] = [];
  private readonly all = new Map<string, Browser>();
  private playwright:
    | (typeof import("playwright"))
    | undefined;
  private initialized = false;

  private async ensurePlaywright() {
    if (this.playwright) {
      return this.playwright;
    }

    if (process.env.PLAYWRIGHT_LIVE !== "true") {
      return undefined;
    }

    try {
      this.playwright = await import("playwright");
      return this.playwright;
    } catch (error) {
      this.logger.warn("Playwright live mode unavailable, falling back to synthetic mode", {
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private async launch(playwright: typeof import("playwright")) {
    const browser = await playwright.chromium.launch({
      headless: true
    });
    const browserId = crypto.randomUUID();
    this.all.set(browserId, browser);
    return {
      browserId,
      browser
    } satisfies BrowserLease;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    const playwright = await this.ensurePlaywright();
    if (!playwright) {
      return;
    }

    for (let index = 0; index < Math.min(this.warmPoolTarget, this.maxBrowsers); index += 1) {
      this.available.push(await this.launch(playwright));
    }
  }

  async acquire() {
    await this.initialize();
    const playwright = await this.ensurePlaywright();
    if (!playwright) {
      return undefined;
    }

    const available = this.available.shift();
    if (available) {
      return available;
    }

    if (this.all.size < this.maxBrowsers) {
      return this.launch(playwright);
    }

    return undefined;
  }

  async release(lease: BrowserLease | undefined) {
    if (!lease) {
      return;
    }

    if (!lease.browser.isConnected()) {
      this.all.delete(lease.browserId);
      return;
    }

    if (this.available.length >= this.warmPoolTarget) {
      await lease.browser.close();
      this.all.delete(lease.browserId);
      return;
    }

    this.available.push(lease);
  }

  health() {
    return {
      configured: process.env.PLAYWRIGHT_LIVE === "true",
      activeBrowsers: this.all.size,
      availableBrowsers: this.available.length,
      warmPoolTarget: this.warmPoolTarget,
      maxBrowsers: this.maxBrowsers
    };
  }

  async closeAll() {
    await Promise.all(
      [...this.all.values()].map(async (browser) => {
        try {
          if (browser.isConnected()) {
            await browser.close();
          }
        } catch {}
      })
    );
    this.available.length = 0;
    this.all.clear();
  }
}

const toWsUrl = (baseUrl: string) => {
  if (baseUrl.startsWith("https://")) {
    return `wss://${baseUrl.slice("https://".length)}`;
  }

  if (baseUrl.startsWith("http://")) {
    return `ws://${baseUrl.slice("http://".length)}`;
  }

  return baseUrl.startsWith("ws://") || baseUrl.startsWith("wss://") ? baseUrl : `ws://${baseUrl}`;
};

const createSyntheticFrame = (session: InternalBrowserSession) => {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">`,
    `<rect width="1280" height="720" fill="#f4efe4"/>`,
    `<rect x="24" y="24" width="1232" height="80" rx="14" fill="#1d3124"/>`,
    `<text x="56" y="74" fill="#f9f6f0" font-size="28" font-family="monospace">JeanBot synthetic browser stream</text>`,
    `<text x="48" y="170" fill="#1d3124" font-size="24" font-family="monospace">URL: ${session.summary.currentUrl}</text>`,
    `<text x="48" y="220" fill="#1d3124" font-size="24" font-family="monospace">Title: ${session.summary.title}</text>`,
    `<text x="48" y="270" fill="#1d3124" font-size="20" font-family="monospace">Session: ${session.summary.id}</text>`,
    `<text x="48" y="320" fill="#1d3124" font-size="20" font-family="monospace">Updated: ${new Date().toISOString()}</text>`,
    "</svg>"
  ].join("");

  return {
    mimeType: "image/svg+xml",
    data: Buffer.from(svg, "utf8").toString("base64")
  };
};

export class BrowserService {
  private readonly logger = createLogger("browser-service");
  private readonly auditService: AuditService;
  private readonly policyService: PolicyService;
  private readonly sessionStore: LocalJsonStore<BrowserSessionSummary>;
  private readonly eventStore: LocalJsonStore<BrowserEventRecord>;
  private readonly captureStore: LocalJsonStore<BrowserCaptureRecord>;
  private readonly sessions = new Map<string, InternalBrowserSession>();
  private readonly pool = new BrowserPool();
  private readonly frameCache = new Map<string, BrowserStreamFrame>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly idleTtlMs = Number(process.env.BROWSER_SESSION_IDLE_TTL_MS ?? 300_000);
  private readonly cleanupIntervalMs = Number(process.env.BROWSER_SESSION_CLEANUP_MS ?? 30_000);
  private cleanupTimer: NodeJS.Timeout | undefined;
  private resolvedMode: BrowserSessionMode = "synthetic";
  private initialized = false;

  constructor(
    auditService = new AuditService(),
    policyService = new PolicyService()
  ) {
    this.auditService = auditService;
    this.policyService = policyService;

    const runtimeRoot = path.resolve("tmp", "runtime", "browser");
    this.sessionStore = new LocalJsonStore<BrowserSessionSummary>(
      ensureDirectory(path.join(runtimeRoot, "sessions"))
    );
    this.eventStore = new LocalJsonStore<BrowserEventRecord>(
      ensureDirectory(path.join(runtimeRoot, "events"))
    );
    this.captureStore = new LocalJsonStore<BrowserCaptureRecord>(
      ensureDirectory(path.join(runtimeRoot, "captures-index"))
    );
  }

  private async initialize() {
    if (this.initialized) {
      return;
    }

    await this.pool.initialize();
    for (const summary of this.sessionStore.list()) {
      this.sessions.set(summary.id, {
        summary
      });
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupIdleSessions();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
    this.initialized = true;
  }

  private async cleanupIdleSessions() {
    const now = Date.now();
    for (const session of await this.listSessions()) {
      if (now - new Date(session.lastActiveAt).getTime() > this.idleTtlMs) {
        await this.closeSession(session.id, "browser-cleanup");
      }
    }
  }

  private async workspaceRoot(workspaceId: string) {
    const root = path.resolve("tmp", "runtime", "browser", "workspaces", workspaceId);
    await fs.mkdir(root, {
      recursive: true
    });
    return root;
  }

  private async captureDirectory(workspaceId: string) {
    const directory = path.join(await this.workspaceRoot(workspaceId), "captures");
    await fs.mkdir(directory, {
      recursive: true
    });
    return directory;
  }

  private assertSafeUrl(url: string) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported browser protocol "${parsed.protocol}".`);
    }
  }

  private async createLiveSession(
    workspaceId: string,
    requestedBy?: string | undefined
  ): Promise<InternalBrowserSession | undefined> {
    const lease = await this.pool.acquire();
    if (!lease) {
      return undefined;
    }

    const context = await lease.browser.newContext({
      acceptDownloads: true
    });
    const page = await context.newPage();
    const createdAt = new Date().toISOString();
    const summary: BrowserSessionSummary = {
      id: crypto.randomUUID(),
      workspaceId,
      currentUrl: "about:blank",
      title: "Blank page",
      mode: "live",
      createdAt,
      lastActiveAt: createdAt,
      requestedBy,
      captureCount: 0,
      frameSequence: 0,
      poolMode: "warm-pool"
    };

    this.resolvedMode = "live";
    return {
      summary,
      lease,
      browser: lease.browser,
      context,
      page
    };
  }

  private createSyntheticSession(
    workspaceId: string,
    requestedBy?: string | undefined
  ): InternalBrowserSession {
    const createdAt = new Date().toISOString();
    this.resolvedMode = "synthetic";
    return {
      summary: {
        id: crypto.randomUUID(),
        workspaceId,
        currentUrl: "about:blank",
        title: "Synthetic browser session",
        mode: "synthetic",
        createdAt,
        lastActiveAt: createdAt,
        requestedBy,
        captureCount: 0,
        frameSequence: 0,
        poolMode: "synthetic"
      }
    };
  }

  private async sessionForRequest(
    workspaceId: string,
    sessionId?: string | undefined,
    requestedBy?: string | undefined
  ) {
    await this.initialize();

    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (!existing) {
        throw new Error(`Browser session "${sessionId}" was not found.`);
      }

      if (existing.summary.workspaceId !== workspaceId) {
        throw new Error(
          `Browser session "${sessionId}" does not belong to workspace "${workspaceId}".`
        );
      }

      return existing;
    }

    const live = await this.createLiveSession(workspaceId, requestedBy);
    return live ?? this.createSyntheticSession(workspaceId, requestedBy);
  }

  private async persistSession(session: InternalBrowserSession) {
    this.sessions.set(session.summary.id, session);
    this.sessionStore.write(session.summary.id, session.summary);
    return session.summary;
  }

  private listEventsForSession(sessionId: string) {
    return this.eventStore
      .list()
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private listCapturesForSession(sessionId: string) {
    return this.captureStore
      .list()
      .filter((capture) => capture.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private streamSubscribers(sessionId: string) {
    const subscribers = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    this.subscribers.set(sessionId, subscribers);
    return subscribers;
  }

  attachSubscriber(sessionId: string, subscriber: Subscriber) {
    const subscribers = this.streamSubscribers(sessionId);
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  latestFrame(sessionId: string) {
    return this.frameCache.get(sessionId);
  }

  private sendStreamEvent(sessionId: string, event: BrowserStreamEvent) {
    const payload = JSON.stringify(event);
    for (const subscriber of [...this.streamSubscribers(sessionId)]) {
      try {
        subscriber.send(payload);
      } catch {
        this.streamSubscribers(sessionId).delete(subscriber);
      }
    }
  }

  private async appendEvent(
    session: InternalBrowserSession,
    kind: BrowserEventRecord["kind"],
    actor: string,
    status: BrowserEventRecord["status"],
    detail: Record<string, unknown>
  ) {
    const event: BrowserEventRecord = {
      id: crypto.randomUUID(),
      sessionId: session.summary.id,
      workspaceId: session.summary.workspaceId,
      kind,
      createdAt: new Date().toISOString(),
      actor,
      status,
      detail
    };

    this.eventStore.write(event.id, event);
    return event;
  }

  private async appendAudit(
    kind: string,
    session: InternalBrowserSession,
    actor: string,
    details: Record<string, unknown>
  ) {
    await this.auditService.record(kind, session.summary.id, actor, {
      workspaceId: session.summary.workspaceId,
      mode: session.summary.mode,
      ...details
    });
  }

  private touchSession(
    session: InternalBrowserSession,
    updates: Partial<
      Pick<
        BrowserSessionSummary,
        "currentUrl" | "title" | "captureCount" | "lastFrameAt" | "frameSequence"
      >
    > = {}
  ) {
    session.summary = {
      ...session.summary,
      ...updates,
      lastActiveAt: new Date().toISOString()
    };
    return session;
  }

  private cacheFrame(session: InternalBrowserSession, frame: BrowserStreamFrame) {
    this.frameCache.set(session.summary.id, frame);
    this.touchSession(session, {
      frameSequence: frame.sequence,
      lastFrameAt: frame.createdAt
    });
    this.sessionStore.write(session.summary.id, session.summary);
    recordCounter("jeanbot_browser_stream_frames_total", "JeanBot browser stream frames", {
      service: "browser-service",
      mode: session.summary.mode
    });
    setGauge("jeanbot_browser_sessions_active", "JeanBot active browser sessions", this.sessions.size, {
      service: "browser-service"
    });
  }

  private async frameForSession(session: InternalBrowserSession) {
    if (session.summary.mode === "live" && session.page) {
      const buffer = await session.page.screenshot({
        type: "jpeg",
        quality: 70,
        fullPage: false
      });
      return {
        mimeType: "image/jpeg",
        data: buffer.toString("base64")
      };
    }

    return createSyntheticFrame(session);
  }

  async captureStreamFrame(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session "${sessionId}" was not found.`);
    }

    const payload = await this.frameForSession(session);
    const frame: BrowserStreamFrame = {
      sequence: session.summary.frameSequence + 1,
      createdAt: new Date().toISOString(),
      mimeType: payload.mimeType,
      data: payload.data
    };
    this.cacheFrame(session, frame);
    const event: BrowserStreamEvent = {
      type: "frame",
      sessionId: session.summary.id,
      workspaceId: session.summary.workspaceId,
      createdAt: frame.createdAt,
      sequence: frame.sequence,
      mimeType: frame.mimeType,
      data: frame.data
    };
    this.sendStreamEvent(session.summary.id, event);
    return event;
  }

  async navigate(request: BrowserNavigateRequest) {
    this.assertSafeUrl(request.url);
    const decision = this.policyService.evaluateTool(browserToolDescriptor, `navigate ${request.url}`);
    const session = await this.sessionForRequest(
      request.workspaceId,
      request.sessionId,
      request.requestedBy
    );

    if (session.summary.mode === "live" && session.page) {
      await session.page.goto(request.url, {
        waitUntil: "domcontentloaded"
      });
      session.page.setDefaultTimeout(10_000);
      const title = await session.page.title();
      this.touchSession(session, {
        currentUrl: session.page.url(),
        title
      });
    } else {
      this.touchSession(session, {
        currentUrl: request.url,
        title: `Synthetic page for ${new URL(request.url).hostname}`
      });
    }

    const summary = await this.persistSession(session);
    const actor = request.requestedBy ?? "browser-service";
    await Promise.all([
      this.appendEvent(session, "navigate", actor, "ok", {
        url: summary.currentUrl,
        title: summary.title,
        approvalRequired: decision.approvalRequired
      }),
      this.appendAudit("browser.navigate", session, actor, {
        url: summary.currentUrl,
        title: summary.title,
        approvalRequired: decision.approvalRequired
      }),
      this.captureStreamFrame(summary.id)
    ]);

    this.logger.info("Browser navigation completed", {
      sessionId: summary.id,
      workspaceId: summary.workspaceId,
      url: summary.currentUrl,
      mode: summary.mode
    });

    return summary;
  }

  private async sessionOrThrow(sessionId: string, workspaceId: string) {
    await this.initialize();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session "${sessionId}" was not found.`);
    }

    if (session.summary.workspaceId !== workspaceId) {
      throw new Error(
        `Browser session "${sessionId}" does not belong to workspace "${workspaceId}".`
      );
    }

    return session;
  }

  private createStreamToken(session: BrowserSessionSummary) {
    const expiresAt = Date.now() + 15 * 60_000;
    const payload = JSON.stringify({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      expiresAt
    });
    const signature = crypto
      .createHmac("sha256", loadPlatformConfig().internalServiceToken)
      .update(payload)
      .digest("hex");
    return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature}`;
  }

  verifyStreamToken(token: string | undefined, sessionId: string) {
    if (!token) {
      throw new Error("Missing browser stream token.");
    }

    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new Error("Invalid browser stream token.");
    }

    const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const expected = crypto
      .createHmac("sha256", loadPlatformConfig().internalServiceToken)
      .update(payload)
      .digest("hex");
    if (expected !== signature) {
      throw new Error("Invalid browser stream token signature.");
    }

    const decoded = JSON.parse(payload) as {
      sessionId: string;
      workspaceId: string;
      expiresAt: number;
    };
    if (decoded.sessionId !== sessionId) {
      throw new Error("Browser stream token does not match the requested session.");
    }

    if (decoded.expiresAt <= Date.now()) {
      throw new Error("Browser stream token has expired.");
    }

    return decoded;
  }

  async getStreamInfo(sessionId: string, workspaceId: string): Promise<BrowserStreamInfo> {
    const session = await this.sessionOrThrow(sessionId, workspaceId);
    const token = this.createStreamToken(session.summary);
    const streamUrl = `${toWsUrl(loadPlatformConfig().browserPublicBaseUrl)}/internal/browser/stream/${sessionId}?token=${token}`;
    return {
      sessionId,
      workspaceId,
      mode: session.summary.mode,
      poolMode: session.summary.poolMode,
      token,
      streamUrl,
      frameRate: FRAME_RATE,
      frameSequence: session.summary.frameSequence,
      lastFrameAt: session.summary.lastFrameAt
    };
  }

  async click(request: BrowserActionRequest) {
    const session = await this.sessionOrThrow(request.sessionId, request.workspaceId);
    const actionLabel =
      request.selector ?? (typeof request.x === "number" && typeof request.y === "number"
        ? `${request.x},${request.y}`
        : "current viewport");
    const decision = this.policyService.evaluateTool(
      browserToolDescriptor,
      `click ${actionLabel}`
    );
    const actor = request.requestedBy ?? "browser-service";

    if (session.summary.mode === "live" && session.page) {
      if (request.selector) {
        await session.page.locator(request.selector).click();
      } else if (typeof request.x === "number" && typeof request.y === "number") {
        await session.page.mouse.click(request.x, request.y);
      } else {
        throw new Error("Click requests require a selector or x/y coordinates.");
      }

      this.touchSession(session, {
        currentUrl: session.page.url(),
        title: await session.page.title()
      });
    } else {
      this.touchSession(session);
    }

    await this.persistSession(session);
    const event = await this.appendEvent(session, "click", actor, "ok", {
      selector: request.selector,
      x: request.x,
      y: request.y,
      approvalRequired: decision.approvalRequired
    });
    await Promise.all([
      this.appendAudit("browser.click", session, actor, event.detail),
      this.captureStreamFrame(session.summary.id)
    ]);

    return {
      session: session.summary,
      event
    };
  }

  async fill(request: BrowserActionRequest) {
    if (!request.selector) {
      throw new Error("Fill requests require a selector.");
    }

    const session = await this.sessionOrThrow(request.sessionId, request.workspaceId);
    const decision = this.policyService.evaluateTool(
      browserToolDescriptor,
      `fill ${request.selector}`
    );
    const actor = request.requestedBy ?? "browser-service";

    if (session.summary.mode === "live" && session.page) {
      await session.page.locator(request.selector).fill(request.value ?? "");
      this.touchSession(session, {
        currentUrl: session.page.url(),
        title: await session.page.title()
      });
    } else {
      this.touchSession(session);
    }

    await this.persistSession(session);
    const event = await this.appendEvent(session, "fill", actor, "ok", {
      selector: request.selector,
      valueLength: request.value?.length ?? 0,
      approvalRequired: decision.approvalRequired
    });
    await Promise.all([
      this.appendAudit("browser.fill", session, actor, event.detail),
      this.captureStreamFrame(session.summary.id)
    ]);

    return {
      session: session.summary,
      event
    };
  }

  async extract(request: BrowserExtractRequest): Promise<BrowserExtractionResult> {
    const session = await this.sessionOrThrow(request.sessionId, request.workspaceId);
    const kind = request.kind ?? "text";
    const actor = request.requestedBy ?? "browser-service";
    let output: unknown;

    if (session.summary.mode === "live" && session.page) {
      if (kind === "links") {
        output = await session.page.$$eval(request.selector ?? "a", (links) =>
          links.slice(0, 20).map((link) => ({
            text: (link.textContent ?? "").trim(),
            href: link.getAttribute("href")
          }))
        );
      } else if (kind === "html") {
        output = request.selector
          ? await session.page.locator(request.selector).first().innerHTML()
          : await session.page.content();
      } else {
        output = request.selector
          ? await session.page.locator(request.selector).allTextContents()
          : await session.page.locator("body").allTextContents();
      }

      this.touchSession(session, {
        currentUrl: session.page.url(),
        title: await session.page.title()
      });
    } else {
      output =
        kind === "links"
          ? [
              {
                text: `Synthetic link for ${session.summary.currentUrl}`,
                href: session.summary.currentUrl
              }
            ]
          : kind === "html"
            ? `<main data-session="${session.summary.id}">Synthetic HTML for ${session.summary.currentUrl}</main>`
            : [`Synthetic extraction for ${session.summary.currentUrl}`];
      this.touchSession(session);
    }

    await this.persistSession(session);
    const detail = {
      selector: request.selector,
      kind,
      size: Array.isArray(output) ? output.length : String(output).length
    };
    await Promise.all([
      this.appendEvent(session, "extract", actor, "ok", detail),
      this.appendAudit("browser.extract", session, actor, detail)
    ]);

    return {
      sessionId: session.summary.id,
      workspaceId: session.summary.workspaceId,
      kind,
      mode: session.summary.mode,
      output
    };
  }

  async capture(request: BrowserCaptureRequest) {
    const session = await this.sessionOrThrow(request.sessionId, request.workspaceId);
    const actor = request.requestedBy ?? "browser-service";
    const captureId = crypto.randomUUID();
    const captureDirectory = await this.captureDirectory(session.summary.workspaceId);
    const extension = session.summary.mode === "live" ? "jpeg" : "svg";
    const capturePath = path.join(captureDirectory, `${captureId}.${extension}`);
    const payload = await this.frameForSession(session);
    await fs.writeFile(capturePath, Buffer.from(payload.data, "base64"));
    const createdAt = new Date().toISOString();
    this.cacheFrame(session, {
      sequence: session.summary.frameSequence + 1,
      createdAt,
      mimeType: payload.mimeType,
      data: payload.data
    });
    if (session.summary.mode === "live" && session.page) {
      this.touchSession(session, {
        currentUrl: session.page.url(),
        title: await session.page.title(),
        captureCount: session.summary.captureCount + 1
      });
    } else {
      this.touchSession(session, {
        captureCount: session.summary.captureCount + 1
      });
    }
    await this.persistSession(session);
    const stats = await fs.stat(capturePath);
    const record: BrowserCaptureRecord = {
      id: captureId,
      sessionId: session.summary.id,
      workspaceId: session.summary.workspaceId,
      path: capturePath,
      url: session.summary.currentUrl,
      mode: session.summary.mode,
      createdAt,
      bytes: stats.size
    };

    this.captureStore.write(record.id, record);
    await Promise.all([
      this.appendEvent(session, "capture", actor, "ok", {
        path: record.path,
        bytes: record.bytes,
        fullPage: request.fullPage ?? true
      }),
      this.appendAudit("browser.capture", session, actor, {
        path: record.path,
        bytes: record.bytes,
        fullPage: request.fullPage ?? true
      })
    ]);

    return record;
  }

  async listSessions() {
    await this.initialize();
    return [...this.sessions.values()]
      .map((session) => session.summary)
      .sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt));
  }

  async getSession(sessionId: string) {
    await this.initialize();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      ...session.summary,
      events: this.listEventsForSession(sessionId),
      captures: this.listCapturesForSession(sessionId)
    };
  }

  async listSessionEvents(sessionId: string) {
    await this.initialize();
    return this.listEventsForSession(sessionId);
  }

  async closeSession(sessionId: string, requestedBy?: string | undefined) {
    await this.initialize();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    await session.page?.close?.();
    await session.context?.close?.();
    await this.pool.release(session.lease);

    this.sessions.delete(sessionId);
    this.sessionStore.delete(sessionId);
    this.frameCache.delete(sessionId);
    this.sendStreamEvent(sessionId, {
      type: "session-closed",
      sessionId,
      workspaceId: session.summary.workspaceId,
      createdAt: new Date().toISOString(),
      sequence: session.summary.frameSequence
    });
    for (const subscriber of this.streamSubscribers(sessionId)) {
      try {
        subscriber.close();
      } catch {}
    }
    this.subscribers.delete(sessionId);
    await Promise.all([
      this.appendEvent(session, "close", requestedBy ?? "browser-service", "ok", {}),
      this.appendAudit("browser.close", session, requestedBy ?? "browser-service", {})
    ]);

    this.logger.info("Closed browser session", {
      sessionId
    });
    return true;
  }

  async close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const sessionIds = [...this.sessions.keys()];
    await Promise.all(sessionIds.map(async (sessionId) => this.closeSession(sessionId, "browser-shutdown")));
    await this.pool.closeAll();
    this.subscribers.clear();
    this.frameCache.clear();
    this.initialized = false;
  }

  health(): ServiceHealth {
    const poolHealth = this.pool.health();
    setGauge("jeanbot_browser_sessions_active", "JeanBot active browser sessions", this.sessions.size, {
      service: "browser-service"
    });
    return {
      name: "browser-service",
      ok: true,
      details: {
        mode: this.resolvedMode,
        activeSessions: this.sessions.size,
        pool: poolHealth
      },
      readiness: {
        browserPool: {
          ok: true,
          status: poolHealth.configured ? "ready" : "degraded",
          message: poolHealth.configured
            ? "Playwright browser pool is ready."
            : "Synthetic browser mode is active because PLAYWRIGHT_LIVE is not enabled.",
          meta: poolHealth
        }
      },
      metricsPath: "/metrics"
    };
  }
}

export const buildBrowserServiceApp = async () => {
  const app = Fastify();
  const service = new BrowserService();
  const config = loadPlatformConfig();
  const requestTimings = new WeakMap<object, number>();
  initTelemetry("browser-service");
  await app.register(websocket);

  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestTimings.get(request) ?? Date.now();
    const route = request.routeOptions.url ?? request.url.split("?")[0];
    const labels = {
      service: "browser-service",
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
      service: "browser-service",
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

  app.post("/internal/browser/navigate", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as BrowserNavigateRequest;
    return service.navigate({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.post("/internal/browser/actions/click", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as BrowserActionRequest;
    return service.click({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.post("/internal/browser/actions/fill", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as BrowserActionRequest;
    return service.fill({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.post("/internal/browser/actions/extract", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as BrowserExtractRequest;
    return service.extract({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.post("/internal/browser/capture", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const body = request.body as BrowserCaptureRequest;
    return service.capture({
      ...body,
      requestedBy: body.requestedBy ?? authContext?.userId
    });
  });

  app.get("/internal/browser/sessions", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    return service.listSessions();
  });

  app.get("/internal/browser/sessions/:sessionId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { sessionId: string };
    return service.getSession(params.sessionId);
  });

  app.get("/internal/browser/sessions/:sessionId/events", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { sessionId: string };
    return service.listSessionEvents(params.sessionId);
  });

  app.get("/internal/browser/sessions/:sessionId/stream-info", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const params = request.params as { sessionId: string };
    const query = request.query as { workspaceId: string };
    return service.getStreamInfo(params.sessionId, query.workspaceId);
  });

  app.delete("/internal/browser/sessions/:sessionId", async (request) => {
    assertInternalRequest(
      request.headers as Record<string, string | string[] | undefined>,
      config.internalServiceToken
    );
    const authContext = authContextFromHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    const params = request.params as { sessionId: string };
    return {
      ok: await service.closeSession(params.sessionId, authContext?.userId)
    };
  });

  app.get(
    "/internal/browser/stream/:sessionId",
    {
      websocket: true
    },
    (connection, request) => {
      const params = request.params as { sessionId: string };
      try {
        service.verifyStreamToken(
          typeof request.query === "object" && request.query !== null
            ? ((request.query as { token?: string }).token ?? undefined)
            : undefined,
          params.sessionId
        );
      } catch (error) {
        connection.socket.send(
          JSON.stringify({
            type: "error",
            sessionId: params.sessionId,
            workspaceId: "unknown",
            createdAt: new Date().toISOString(),
            sequence: 0,
            detail: {
              message: error instanceof Error ? error.message : String(error)
            }
          } satisfies BrowserStreamEvent)
        );
        connection.socket.close();
        return;
      }

      const subscriber: Subscriber = {
        send(payload) {
          connection.socket.send(payload);
        },
        close() {
          connection.socket.close();
        }
      };
      const detach = service.attachSubscriber(params.sessionId, subscriber);

      void (async () => {
        const session = await service.getSession(params.sessionId);
        if (!session) {
          subscriber.close();
          detach();
          return;
        }

        subscriber.send(
          JSON.stringify({
            type: "connected",
            sessionId: session.id,
            workspaceId: session.workspaceId,
            createdAt: new Date().toISOString(),
            sequence: session.frameSequence,
            detail: {
              frameRate: FRAME_RATE
            }
          } satisfies BrowserStreamEvent)
        );

        const cachedFrame = service.latestFrame(params.sessionId);
        if (cachedFrame) {
          subscriber.send(
            JSON.stringify({
              type: "frame",
              sessionId: session.id,
              workspaceId: session.workspaceId,
              createdAt: cachedFrame.createdAt,
              sequence: cachedFrame.sequence,
              mimeType: cachedFrame.mimeType,
              data: cachedFrame.data
            } satisfies BrowserStreamEvent)
          );
        }

        const interval = setInterval(() => {
          void service.captureStreamFrame(params.sessionId).catch((streamError) => {
            subscriber.send(
              JSON.stringify({
                type: "error",
                sessionId: session.id,
                workspaceId: session.workspaceId,
                createdAt: new Date().toISOString(),
                sequence: session.frameSequence,
                detail: {
                  message:
                    streamError instanceof Error ? streamError.message : String(streamError)
                }
              } satisfies BrowserStreamEvent)
            );
          });
        }, FRAME_INTERVAL_MS);

        connection.socket.on("close", () => {
          clearInterval(interval);
          detach();
        });
      })();
    }
  );

  return {
    app,
    service
  };
};
