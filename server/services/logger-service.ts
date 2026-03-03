export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  userId?: string;
  requestId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}

class Logger {
  private context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  private formatMessage(entry: LogEntry): string {
    const baseMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
    const contextMessage = entry.context ? ` [${entry.context}]` : '';
    const userMessage = entry.userId ? ` [user:${entry.userId}]` : '';
    const requestMessage = entry.requestId ? ` [req:${entry.requestId}]` : '';
    
    return `${baseMessage}${contextMessage}${userMessage}${requestMessage} ${entry.message}`;
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: this.context,
      metadata
    };

    // Add user ID if available in async context
    if (metadata?.userId) {
      entry.userId = metadata.userId;
    }

    // Add request ID if available
    if (metadata?.requestId) {
      entry.requestId = metadata.requestId;
    }

    // Format and output
    const formattedMessage = this.formatMessage(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, metadata || '');
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, metadata || '');
        break;
      case LogLevel.INFO:
        console.info(formattedMessage, metadata || '');
        break;
      case LogLevel.DEBUG:
        if (process.env.NODE_ENV !== 'production') {
          console.debug(formattedMessage, metadata || '');
        }
        break;
    }

    // In production, you might want to send logs to external service
    if (process.env.NODE_ENV === 'production') {
      // TODO: Send to external logging service (e.g., Winston, ELK, etc.)
    }
  }

  error(message: string, error?: Error | Record<string, any>): void {
    let metadata: Record<string, any> = {};

    if (error instanceof Error) {
      metadata = {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      };
    } else if (error) {
      metadata = error;
    }

    this.log(LogLevel.ERROR, message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  child(context: string): Logger {
    return new Logger(this.context ? `${this.context}:${context}` : context);
  }
}

// Default logger instance
export const logger = new Logger('APP');

// Create context-specific loggers
export const createLogger = (context: string): Logger => {
  return new Logger(context);
};

// Request-specific logger helper
export const createRequestLogger = (requestId: string, userId?: string): Omit<Logger, 'formatMessage' | 'log' | 'child'> => {
  const requestLogger = new Logger('REQUEST');
  return {
    error: (message: string, error?: Error | Record<string, any>) => 
      requestLogger.error(message, { requestId, userId, ...(error instanceof Error ? { error: { name: error.name, message: error.message, stack: error.stack } } : error) }),
    warn: (message: string, metadata?: Record<string, any>) => 
      requestLogger.warn(message, { requestId, userId, ...metadata }),
    info: (message: string, metadata?: Record<string, any>) => 
      requestLogger.info(message, { requestId, userId, ...metadata }),
    debug: (message: string, metadata?: Record<string, any>) => 
      requestLogger.debug(message, { requestId, userId, ...metadata })
  };
};
