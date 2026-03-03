import { createLogger } from './logger-service';

const logger = createLogger('SECURITY_VALIDATION');

// XSS Protection Patterns
export const XSS_PATTERNS = [
  /<script\b/i,
  /\son[a-z0-9_-]+\s*=/i,
  /javascript:/i,
  /vbscript:/i,
];

// SQL Injection Patterns
export const SQL_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
  /(--|\*|;|\/\*|\*\/|@@|@|CHAR|NCHAR|VARCHAR|NVARCHAR|ALTER|BEGIN|CAST|CREATE|CURSOR|DECLARE|DELETE|DENY|DISK|DROP|END|EXECUTE|FETCH|FILE|FILL|GRANT|GROUP|HAVING|IDENTITY|INSET|INTO|KILL|LIKE|LOAD|MERGE|NOCHECK|OPEN|PRINT|PRIVILEGES|PROCEDURE|PUBLIC|RAISERROR|READ|REFERENCES|RENAME|REPLACE|RESTORE|RESTRICT|RETURN|REVOKE|ROLLBACK|ROWCOUNT|RULE|SAVE|SCHEMA|SELECT|SET|SHUTDOWN|TABLE|TEXTSIZE|THEN|TO|TRAN|TRANSACTION|TRIGGER|TRUNCATE|UNION|UNIQUE|UPDATE|USE|VALUES|VIEW|WHERE|WHILE|WITH|WORK)/gi
];

// HTML Content Validation Patterns
export const HTML_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /<iframe[^>]*>/gi,
  /<object[^>]*>/gi,
  /<embed[^>]*>/gi,
  /<form\b/i,
  /<meta[^>]*http-equiv=["']?refresh/i,
];

// Combined Security Patterns (only XSS patterns for HTML validation)
export const SECURITY_PATTERNS = [
  ...XSS_PATTERNS,
];

// Validation Functions
export const validateXSS = (content: string): boolean => {
  return !XSS_PATTERNS.some(pattern => pattern.test(content));
};

export const validateSQLInjection = (content: string): boolean => {
  return !SQL_PATTERNS.some(pattern => pattern.test(content));
};

export const validateHTML = (content: string): boolean => {
  return !HTML_PATTERNS.some(pattern => pattern.test(content));
};

export const validateSecurity = (content: string): { isValid: boolean; pattern?: RegExp } => {
  for (const pattern of SECURITY_PATTERNS) {
    if (pattern.test(content)) {
      logger.warn('Security validation failed', { pattern: pattern.source });
      return { isValid: false, pattern };
    }
  }
  return { isValid: true };
};

// Content Sanitization
export const sanitizeContent = (content: string): string => {
  let sanitized = content;
  
  // Remove script tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove dangerous event handlers
  sanitized = sanitized.replace(/\son[a-z0-9_-]+\s*=/gi, '');
  
  // Remove dangerous protocols
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/vbscript:/gi, '');
  
  return sanitized;
};

// Field Validation
export const validateFieldLength = (value: string, fieldName: string, maxLength: number): void => {
  if (value && value.length > maxLength) {
    throw new Error(
      `${fieldName} is too long. Maximum ${maxLength} characters.`
    );
  }
};
