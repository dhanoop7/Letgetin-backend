import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';
import { AppError } from '../utils/appError.js';
import { env } from '../config/env.js';

export const errorHandler = (
  err: Error | AppError | ZodError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const timestamp = new Date().toISOString();

  // Zod Validation Error
  if (err instanceof ZodError) {
    const formattedDetails = err.errors.map((e: ZodIssue) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: formattedDetails,
      },
      timestamp,
    });
    return;
  }

  // Known Operational AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || null,
      },
      timestamp,
    });
    return;
  }

  // Unhandled / Programming Errors
  console.error('🔥 Unhandled Exception:', err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
    timestamp,
  });
};
