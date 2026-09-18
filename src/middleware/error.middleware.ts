import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';
import { AppError } from '../utils/appError.js';
import { logger } from '../infrastructure/logging/logger.js';

export const errorHandler = (
  err: Error | AppError | ZodError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const timestamp = new Date().toISOString();
  const requestId = (req.id || req.headers['x-request-id'] || req.headers['x-correlation-id'] || 'unknown') as string;
  const user = (req as any).user;
  const userId = user?.userId;

  // Extract contextual IDs if present
  const context: Record<string, any> = {
    requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    userId,
  };
  if (req.params?.jobId) context.jobId = req.params.jobId;
  if (req.params?.applicationId) context.applicationId = req.params.applicationId;
  if (req.body?.jobId) context.jobId = req.body.jobId;

  // 1. Zod Validation Error (HTTP 400 / 422)
  if (err instanceof ZodError) {
    const formattedDetails = err.errors.map((e: ZodIssue) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    logger.warn(
      {
        ...context,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        details: formattedDetails,
      },
      `Validation error on ${req.method} ${context.path}`
    );

    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: formattedDetails,
      },
      requestId,
      timestamp,
    });
    return;
  }

  // 2. Known Operational AppError (400, 401, 403, 404, 409, 429, etc.)
  if (err instanceof AppError) {
    const level = err.statusCode >= 500 ? 'error' : 'warn';

    logger[level](
      {
        ...context,
        statusCode: err.statusCode,
        errorCode: err.code,
        message: err.message,
        details: err.details || null,
        stack: err.statusCode >= 500 ? err.stack : undefined,
      },
      `Operational ${err.code} (${err.statusCode}) on ${req.method} ${context.path}: ${err.message}`
    );

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || null,
      },
      requestId,
      timestamp,
    });
    return;
  }

  // 3. Unhandled / Programming Errors (500 Internal Server Error)
  logger.error(
    {
      ...context,
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      errName: err.name,
      errMessage: err.message,
      stack: err.stack,
    },
    `Unhandled exception on ${req.method} ${context.path}: ${err.message}`
  );

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
    requestId,
    timestamp,
  });
};
