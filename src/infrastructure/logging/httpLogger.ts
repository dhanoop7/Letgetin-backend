import { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import crypto from 'crypto';
import { logger } from './logger.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: Request, res: Response): string => {
    const existingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
    const id = (typeof existingId === 'string' && existingId.trim().length > 0)
      ? existingId.trim()
      : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req: Request, res: Response, err?: Error): 'error' | 'warn' | 'info' => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req: Request, res: Response): string => {
    return `${req.method} ${req.originalUrl || req.url} - ${res.statusCode}`;
  },
  customErrorMessage: (req: Request, res: Response, err: Error): string => {
    return `${req.method} ${req.originalUrl || req.url} - ${res.statusCode} (Error: ${err.message})`;
  },
  customProps: (req: Request): Record<string, any> => {
    const reqWithUser = req as Request & { user?: { userId?: string; role?: string } };
    return {
      requestId: req.id,
      userId: reqWithUser.user?.userId,
      userRole: reqWithUser.user?.role,
    };
  },
  serializers: {
    req: (req: any) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      remoteAddress: req.remoteAddress,
    }),
    res: (res: any) => ({
      statusCode: res.statusCode,
    }),
  },
});

export default httpLogger;
