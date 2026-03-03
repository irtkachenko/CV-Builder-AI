import type { Request, Response, NextFunction } from 'express';
import { appConfig } from '../config/app-config';
import { logger, createRequestLogger } from '../services/logger-service';

// Класи помилок для різних типів
export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = 'ApplicationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, field?: string) {
    super('VALIDATION_ERROR', message, 400);
    if (field) {
      (this as any).field = field;
    }
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class RateLimitError extends ApplicationError {
  constructor(message: string) {
    super('RATE_LIMIT_EXCEEDED', message, 429);
  }
}

export class FileProcessingError extends ApplicationError {
  constructor(message: string) {
    super('FILE_PROCESSING_ERROR', message, 400);
  }
}

export class AIServiceError extends ApplicationError {
  constructor(message: string) {
    super('AI_SERVICE_ERROR', message, 502);
  }
}

// Глобальний обробник помилок
export const globalErrorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Створюємо request logger
  const requestLogger = createRequestLogger(
    req.headers['x-request-id'] as string || 'unknown',
    (req as any).user?.claims?.sub
  );

  // Логуємо помилку з деталями
  requestLogger.error('Unhandled error occurred', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
      statusCode: (error as any).statusCode
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }
  });

  // Визначаємо тип помилки та статус
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'Internal Server Error';
  let details: any = {};

  if (error instanceof ApplicationError) {
    statusCode = error.statusCode;
    errorCode = error.code;
    message = error.message;
    
    // Додаємо додаткові поля якщо є
    if ((error as any).field) {
      details.field = (error as any).field;
    }
  } else if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = error.message;
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorCode = 'INVALID_ID';
    message = 'Invalid ID format';
  } else if (error.message.includes('ENOENT')) {
    statusCode = 404;
    errorCode = 'FILE_NOT_FOUND';
    message = 'File not found';
  } else if (error.message.includes('EACCES')) {
    statusCode = 403;
    errorCode = 'FILE_ACCESS_DENIED';
    message = 'File access denied';
  }

  // В production режимі не показуємо деталі помилок
  const isProduction = process.env.NODE_ENV === 'production';
  
  const response: any = {
    success: false,
    error: {
      code: errorCode,
      message: isProduction && statusCode === 500 ? 'Internal Server Error' : message,
      timestamp: new Date().toISOString()
    }
  };

  // Додаємо деталі якщо вони є
  if (Object.keys(details).length > 0) {
    response.error.details = details;
  }

  // В development режимі додаємо stack trace
  if (!isProduction) {
    response.error.stack = error.stack;
    response.error.name = error.name;
  }

  res.status(statusCode).json(response);
};

// Обробник 404 помилок
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path}`);
  next(error);
};

// Async wrapper для обробки async помилок
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Middleware для обробки uncaught exceptions
export const setupErrorHandlers = (): void => {
  // Обробка uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
    
    // Graceful shutdown
    process.exit(1);
  });

  // Обробка unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', {
      reason: reason,
      promise: promise.toString()
    });
    
    // Graceful shutdown
    process.exit(1);
  });
};
