import { SpanStatusCode, trace } from "@opentelemetry/api";
import * as Sentry from "@sentry/node";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const registry = new Registry();
const counters = new Map<string, Counter<string>>();
const gauges = new Map<string, Gauge<string>>();
const histograms = new Map<string, Histogram<string>>();

let sentryReady = false;
let defaultMetricsReady = false;

export interface Span {
  name: string;
  startedAt: number;
  end(meta?: Record<string, unknown>): void;
  fail(error: unknown): void;
}

export const initTelemetry = (serviceName: string) => {
  if (!defaultMetricsReady) {
    collectDefaultMetrics({
      register: registry,
      prefix: "jeanbot_node_"
    });
    defaultMetricsReady = true;
  }

  if (process.env.SENTRY_DSN && !sentryReady) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1
    });
    sentryReady = true;
  }

  return {
    serviceName,
    registry
  };
};

export const recordCounter = (
  name: string,
  help: string,
  labels: Record<string, string> = {}
) => {
  let counter = counters.get(name);
  if (!counter) {
    counter = new Counter({
      name,
      help,
      labelNames: Object.keys(labels),
      registers: [registry]
    });
    counters.set(name, counter);
  }

  if (Object.keys(labels).length > 0) {
    counter.inc(labels);
    return;
  }

  counter.inc();
};

export const recordDuration = (
  name: string,
  help: string,
  valueMs: number,
  labels: Record<string, string> = {}
) => {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = new Histogram({
      name,
      help,
      labelNames: Object.keys(labels),
      buckets: [10, 50, 100, 250, 500, 1_000, 5_000, 15_000],
      registers: [registry]
    });
    histograms.set(name, histogram);
  }

  if (Object.keys(labels).length > 0) {
    histogram.observe(labels, valueMs);
    return;
  }

  histogram.observe(valueMs);
};

export const metrics = async () => registry.metrics();

export const captureException = (error: unknown, context?: Record<string, unknown>) => {
  if (sentryReady) {
    if (context) {
      Sentry.captureException(error, {
        extra: context
      } as never);
      return;
    }

    Sentry.captureException(error);
  }
};

export const setGauge = (
  name: string,
  help: string,
  value: number,
  labels: Record<string, string> = {}
) => {
  let gauge = gauges.get(name);
  if (!gauge) {
    gauge = new Gauge({
      name,
      help,
      labelNames: Object.keys(labels),
      registers: [registry]
    });
    gauges.set(name, gauge);
  }

  if (Object.keys(labels).length > 0) {
    gauge.set(labels, value);
    return;
  }

  gauge.set(value);
};

export const startSpan = (name: string): Span => {
  const tracer = trace.getTracer("jeanbot");
  const span = tracer.startSpan(name);
  const startedAt = Date.now();

  return {
    name,
    startedAt,
    end(meta = {}) {
      for (const [key, value] of Object.entries(meta)) {
        span.setAttribute(key, String(value));
      }
      span.end();
      recordDuration("jeanbot_span_duration_ms", "JeanBot span duration", Date.now() - startedAt, {
        span: name
      });
    },
    fail(error) {
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error instanceof Error ? error : new Error(message));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message
      });
      span.end();
      captureException(error, {
        span: name
      });
    }
  };
};
