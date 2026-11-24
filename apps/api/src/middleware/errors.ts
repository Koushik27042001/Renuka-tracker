import type { ErrorRequestHandler, Request, Response } from 'express';
import { Error as MongooseError, mongo } from 'mongoose';

export type FieldError = { field: string; message: string };

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: FieldError[],
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, 'Authentication failed');
export const unavailable = () => new AppError(503, 'Service temporarily unavailable');

export function sendError(req: Request, res: Response, error: AppError) {
  res.status(error.status).json({
    success: false,
    message: error.message,
    requestId: req.id,
    ...(error.errors ? { errors: error.errors } : {}),
  });
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) return sendError(req, res, error);
  if (error instanceof MongooseError.CastError)
    return sendError(req, res, new AppError(400, 'Invalid identifier'));
  if (error instanceof MongooseError.ValidationError)
    return sendError(req, res, new AppError(400, 'Validation failed'));
  if (error instanceof mongo.MongoServerError && error.code === 11000) {
    return sendError(req, res, new AppError(409, 'Record already exists'));
  }
  if (
    error instanceof mongo.MongoNetworkError ||
    error instanceof mongo.MongoServerSelectionError ||
    error instanceof mongo.MongoOperationTimeoutError ||
    error instanceof MongooseError.MongooseServerSelectionError
  ) {
    req.log.warn('Database operation unavailable');
    return sendError(req, res, unavailable());
  }
  if (error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.too.large' || error.type === 'parameters.too.many') {
      return sendError(req, res, new AppError(413, 'Request body too large'));
    }
    if (
      error.type === 'entity.parse.failed' ||
      error.type === 'request.size.invalid' ||
      error.type === 'request.aborted'
    ) {
      return sendError(req, res, new AppError(400, 'Malformed request body'));
    }
    if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      return sendError(req, res, new AppError(415, 'Unsupported request encoding'));
    }
  }
  req.log.error(
    { errorType: error instanceof Error ? error.constructor.name : typeof error },
    'Unexpected request error',
  );
  sendError(req, res, new AppError(500, 'An unexpected error occurred'));
};
