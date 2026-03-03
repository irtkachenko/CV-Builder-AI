import helmet from 'helmet';
import { createLogger } from '../services/logger-service';

const logger = createLogger('SECURITY');

// Конфігурація Helmet для нашого CV Builder на Replit
export const securityConfig = {
  // Content Security Policy - адаптована для Replit
  contentSecurityPolicy: {
    directives: {
      // Дозволені джерела за замовчуванням
      defaultSrc: ["'self'"],
      
      // Скрипти - Replit CDN + наш домен
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", // Для inline скриптів в development
        "https://cdn.replit.com", // Replit CDN
        "https://cdn.jsdelivr.net",
        "https://unpkg.com"
      ],
      
      // Стилі - дозволяємо inline стилі для CV
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", // Для inline стилів в CV
        "https://fonts.googleapis.com",
        "https://cdn.replit.com", // Replit CDN
        "https://cdn.jsdelivr.net"
      ],
      
      // Шрифти з Google Fonts та CDN
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdn.replit.com", // Replit CDN
        "https://cdn.jsdelivr.net"
      ],
      
      // Зображення - з будь-якого домену (для CV зображень)
      imgSrc: [
        "'self'",
        "data:", // Для base64 зображень
        "https:", // Для HTTPS зображень
        "http:", // Для локальних зображень в development
        "https://cdn.replit.com" // Replit CDN
      ],
      
      // Підключення до API
      connectSrc: [
        "'self'",
        "https://openrouter.ai", // AI API
        "wss://*.replit.com", // Replit WebSocket
        "ws://localhost:*" // Development WebSocket
      ],
      
      // Фрейми - забороняємо (clickjacking protection)
      frameSrc: ["'none'"],
      childSrc: ["'none'"],
      
      // Об'єкти та embeds
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      
      // Базові URI
      baseUri: ["'self'"],
      
      // Форми - тільки на наш домен
      formAction: ["'self'"],
      
      // Frame ancestors - забороняємо iframe
      frameAncestors: ["'none'"]
    },
  },

  // HSTS - Replit вже обробляє HTTPS, але додамо для production
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000, // 1 рік
    includeSubDomains: false, // Replit subdomains не потрібні
    preload: false // Replit не підтримує preload list
  } : false,

  // X-Frame-Options - захист від clickjacking (важливо для CV)
  frameguard: {
    action: 'deny' as const // DENY - повна заборона iframe
  },

  // X-Content-Type-Options - захист від MIME sniffing
  noSniff: true,

  // X-XSS-Protection - XSS фільтр браузера
  xssFilter: true,

  // Referrer Policy - адаптована для Replit
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin' as const
  },

  // Додаткові заголовки - спрощені для Replit
  crossOriginEmbedderPolicy: false, // Вимкнемо для простоти
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  
  // DNS Prefetch Control
  dnsPrefetchControl: {
    allow: false
  },

  // Permit Cross-Origin Opener Policy
  permittedCrossDomainPolicies: false,

  // Hide X-Powered-By header
  hidePoweredBy: true
};

// Middleware для Helmet
export const securityHeadersMiddleware = helmet(securityConfig);

// Development конфігурація (менш сувора)
export const developmentSecurityConfig = {
  ...securityConfig,
  contentSecurityPolicy: {
    ...securityConfig.contentSecurityPolicy,
    directives: {
      ...securityConfig.contentSecurityPolicy.directives,
      // В development дозволяємо більше для зручності
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'", // Для React DevTools
        "https://cdn.replit.com", // Replit CDN
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "ws:", // WebSocket для hot reload
        "wss:"
      ],
      connectSrc: [
        "'self'",
        "https://openrouter.ai",
        "wss://*.replit.com", // Replit WebSocket
        "ws://localhost:*", // Development WebSocket
        "http://localhost:3000", // Development server
        "http://localhost:5173"  // Vite dev server
      ]
    }
  }
};

// Middleware для development
export const developmentSecurityHeadersMiddleware = helmet(developmentSecurityConfig);

// Функція для отримання правильного middleware
export const getSecurityMiddleware = () => {
  if (process.env.NODE_ENV === 'production') {
    logger.info('Using production security headers');
    return securityHeadersMiddleware;
  } else {
    logger.info('Using development security headers');
    return developmentSecurityHeadersMiddleware;
  }
};

// Допоміжна функція для валідації CSP звітів
export const handleCSPViolation = (req: any, res: any) => {
  // Логуємо CSP violations для моніторингу атак
  logger.warn('CSP Violation', {
    'user-agent': req.get('User-Agent'),
    'blocked-uri': req.body['blocked-uri'],
    'document-uri': req.body['document-uri'],
    'original-policy': req.body['original-policy'],
    'disposition': req.body['disposition'],
    'effective-directive': req.body['effective-directive'],
    'violated-directive': req.body['violated-directive'],
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  res.status(204).end();
};
