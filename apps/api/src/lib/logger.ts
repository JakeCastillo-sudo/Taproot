/**
 * logger — structured JSON logging for non-Fastify contexts (workers, startup,
 * process-level handlers). Fastify routes use the pino instance; this gives the
 * same structured shape elsewhere and is a single seam to pipe to Datadog/Logtail.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const entry = { timestamp: new Date().toISOString(), level, message, ...(context ? { context } : {}) };
  const line = JSON.stringify(entry);
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
