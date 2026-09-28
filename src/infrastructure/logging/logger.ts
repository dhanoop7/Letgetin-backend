import pino, { Logger, LoggerOptions } from 'pino';
import { env } from '../../config/env.js';

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'apiKey',
  'secret',
  'credentials',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'body.password',
  'body.token',
  'body.apiKey',
  'body.secret',
];

const isProduction = env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const options: LoggerOptions = {
  level: logLevel,
  redact: {
    paths: SENSITIVE_FIELDS,
    censor: REDACTED_PLACEHOLDER,
  },
  base: {
    service: 'letgetin-backend',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname,service,env',
          },
        },
      }),
};

export const logger: Logger = pino(options);

/**
 * Creates a child logger with predefined context (e.g. component, queue, module).
 */
export const createChildLogger = (bindings: Record<string, any>): Logger => {
  return logger.child(bindings);
};

export default logger;
