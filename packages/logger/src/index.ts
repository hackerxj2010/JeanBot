import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface Logger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  raw(): PinoLogger;
}

const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime
});

const wrapLogger = (logger: PinoLogger): Logger => ({
  trace(message, context) {
    logger.trace(context ?? {}, message);
  },
  debug(message, context) {
    logger.debug(context ?? {}, message);
  },
  info(message, context) {
    logger.info(context ?? {}, message);
  },
  warn(message, context) {
    logger.warn(context ?? {}, message);
  },
  error(message, context) {
    logger.error(context ?? {}, message);
  },
  child(bindings) {
    return wrapLogger(logger.child(bindings));
  },
  raw() {
    return logger;
  }
});

export const createLogger = (
  service: string,
  bindings: Record<string, unknown> = {}
): Logger => {
  return wrapLogger(rootLogger.child({ service, ...bindings }));
};
