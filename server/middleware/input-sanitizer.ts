import type { Request, Response, NextFunction } from 'express';
import DOMPurify from 'dompurify';
import { createLogger } from '../services/logger-service';
import { ValidationError } from './error-handler';

const logger = createLogger('INPUT_SANITIZER');

// Конфігурація DOMPurify для максимальної безпеки
const purifyConfig = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'i', 'u', 'b', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'div', 'section', 'article', 'header', 'footer',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  ALLOWED_ATTR: [
    'class', 'id', 'style', 'href', 'target', 'rel',
    'colspan', 'rowspan', 'align', 'valign'
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'object', 'embed', 'iframe', 'form', 'input'],
  FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus'],
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  KEEP_CONTENT: true,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false
};

export interface SanitizedRequest extends Request {
  sanitizedBody?: any;
  sanitizedQuery?: any;
  sanitizedParams?: any;
}

// Основна функція санітизації з DOMPurify
function sanitizeWithDOMPurify(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') {
    return dirty;
  }
  
  return DOMPurify.sanitize(dirty, purifyConfig);
}

// Санітизація рядкових полів з додатковою валідацією
function sanitizeString(value: any): string {
  if (!value || typeof value !== 'string') {
    return value;
  }

  // Спочатку DOMPurify для XSS захисту
  let sanitized = DOMPurify.sanitize(value, purifyConfig);
  
  // Додаткова валідація для SQL injection
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
    /(--|\*|;|\/\*|\*\/|@@|@|CHAR|NCHAR|VARCHAR|NVARCHAR|ALTER|BEGIN|CAST|CREATE|CURSOR|DECLARE|DELETE|DENY|DISK|DROP|END|EXECUTE|FETCH|FILE|FILL|GRANT|GROUP|HAVING|IDENTITY|INSET|INTO|KILL|LIKE|LOAD|MERGE|NOCHECK|OPEN|PRINT|PRIVILEGES|PROCEDURE|PUBLIC|RAISERROR|READ|REFERENCES|RENAME|REPLACE|RESTORE|RESTRICT|RETURN|REVOKE|ROLLBACK|ROWCOUNT|RULE|SAVE|SCHEMA|SELECT|SET|SHUTDOWN|TABLE|TEXTSIZE|THEN|TO|TRAN|TRANSACTION|TRIGGER|TRUNCATE|UNION|UNIQUE|UPDATE|USE|VALUES|VIEW|WHERE|WHILE|WITH|WORK)/gi
  ];

  sqlPatterns.forEach(pattern => {
    if (pattern.test(sanitized)) {
      logger.warn('SQL injection pattern detected', { 
        pattern: pattern.source,
        originalLength: value.length,
        sanitizedLength: sanitized.length 
      });
      sanitized = sanitized.replace(pattern, '');
    }
  });

  // Валідація довжини
  if (sanitized.length > 10000) {
    logger.warn('Input too long after sanitization', { 
      originalLength: value.length,
      sanitizedLength: sanitized.length 
    });
    sanitized = sanitized.substring(0, 10000);
  }

  return sanitized.trim();
}

// Рекурсивна санітизація об'єктів
function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized: any = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

// Валідація довжини полів з помилками
function validateFieldLength(value: string, fieldName: string, maxLength: number): void {
  if (value && value.length > maxLength) {
    throw new ValidationError(
      `${fieldName} is too long. Maximum ${maxLength} characters.`,
      fieldName
    );
  }
}

// Основний middleware
export const inputSanitizerMiddleware = (
  req: SanitizedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    logger.debug('Input sanitization started', { 
      method: req.method, 
      url: req.url,
      hasBody: !!req.body,
      hasQuery: !!req.query,
      hasParams: !!req.params
    });

    // Санітизація body
    if (req.body) {
      req.sanitizedBody = sanitizeObject(req.body);
      
      // Валідація критичних полів
      if (req.sanitizedBody.generationPrompt) {
        validateFieldLength(req.sanitizedBody.generationPrompt, 'generationPrompt', 600);
      }
      
      if (req.sanitizedBody.editPrompt) {
        validateFieldLength(req.sanitizedBody.editPrompt, 'editPrompt', 1000);
      }
    }

    // Санітизація query параметрів
    if (req.query) {
      req.sanitizedQuery = sanitizeObject(req.query);
    }

    // Санітизація URL параметрів
    if (req.params) {
      req.sanitizedParams = sanitizeObject(req.params);
    }

    logger.debug('Input sanitization completed', {
      method: req.method,
      url: req.url,
      bodyFields: req.body ? Object.keys(req.body).length : 0,
      queryFields: req.query ? Object.keys(req.query).length : 0,
      paramFields: req.params ? Object.keys(req.params).length : 0
    });

    next();
  } catch (error) {
    logger.error('Input sanitization failed', { 
      error, 
      url: req.url,
      method: req.method 
    });
    next(error);
  }
};

// Специфічний middleware для HTML контенту з DOMPurify
export const htmlSanitizerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    // Санітизація HTML полів у відповіді з DOMPurify
    if (data && data.htmlContent) {
      const originalLength = data.htmlContent.length;
      data.htmlContent = sanitizeWithDOMPurify(data.htmlContent);
      
      logger.debug('HTML content sanitized with DOMPurify', { 
        url: req.url,
        originalLength,
        sanitizedLength: data.htmlContent.length,
        wasTruncated: originalLength !== data.htmlContent.length
      });
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

// Допоміжні функції для використання в сервісах
export const sanitizeField = (value: string): string => sanitizeString(value);
export const sanitizeHtmlContent = (html: string): string => sanitizeWithDOMPurify(html);

// Функція для валідації HTML контенту
export function validateHTML(html: string): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Перевірка на небезпечні теги (після санітизації)
  const dangerousPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>/gi,
    /<object[^>]*>/gi,
    /<embed[^>]*>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi
  ];

  dangerousPatterns.forEach(pattern => {
    if (pattern.test(html)) {
      issues.push(`Potentially dangerous content detected: ${pattern.source}`);
    }
  });

  // Перевірка на надмірну довжину
  if (html.length > 100_000) {
    issues.push('HTML content too long (>100KB)');
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}
