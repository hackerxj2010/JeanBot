import pino from "pino";
const rootLogger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime
});
const wrapLogger = (logger) => ({
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
export const createLogger = (service, bindings = {}) => {
    return wrapLogger(rootLogger.child({ service, ...bindings }));
};
//# sourceMappingURL=index.js.map