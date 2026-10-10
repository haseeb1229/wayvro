/**
 * Structured JSON logging (pino) with mandatory redaction and correlation ids. Telemetry dimensions such as
 * `mode`/`profile_kind` must be low-cardinality and never identifiers (V12/Q36).
 */
import { pino, type Logger, type LoggerOptions } from 'pino';
import { currentContext } from './context.js';
import { redact, redactString } from './redaction.js';

export type { Logger } from 'pino';

export interface LoggerConfig {
  readonly service: string;
  readonly env: string;
  readonly level: LoggerOptions['level'];
  /** Optional destination (tests capture output); defaults to stdout. */
  readonly destination?: pino.DestinationStream;
}

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: { service: config.service, env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => redact(object) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const [first, ...rest] = args;
        const scrubbed = rest.map((a) => (typeof a === 'string' ? redactString(a) : a));
        const scrubbedFirst: unknown = typeof first === 'string' ? redactString(first) : first;
        method.apply(this, [scrubbedFirst, ...scrubbed] as Parameters<typeof method>);
      },
    },
    mixin: () => {
      const ctx = currentContext();
      return ctx ? { requestId: ctx.requestId } : {};
    },
  };
  return config.destination ? pino(options, config.destination) : pino(options);
}
