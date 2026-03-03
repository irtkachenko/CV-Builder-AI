import rateLimit from "express-rate-limit";
import { appConfig } from "../config/app-config";

export const aiRequestLimiter = rateLimit({
  windowMs: appConfig.rateLimits.aiRequestsWindowMs,
  max: appConfig.rateLimits.aiRequestsPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.claims?.sub || req.ip,
  message: {
    message: `You have reached the hourly AI request limit (${appConfig.rateLimits.aiRequestsPerHour}). Please try again later.`,
    code: "RATE_LIMIT_EXCEEDED",
  },
});

// File upload limiter - запобігає спаму завантажень
export const fileUploadLimiter = rateLimit({
  windowMs: appConfig.rateLimits.fileUploadsWindowMs,
  max: appConfig.rateLimits.fileUploadsPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.claims?.sub || req.ip,
  message: {
    message: `Too many file uploads (${appConfig.rateLimits.fileUploadsPerMinute} per minute). Please wait before uploading another file.`,
    code: "UPLOAD_RATE_LIMIT_EXCEEDED",
  },
});

// CV creation limiter - обмежує створення нових CV
export const cvCreationLimiter = rateLimit({
  windowMs: appConfig.rateLimits.cvCreationsWindowMs,
  max: appConfig.rateLimits.cvCreationsPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.claims?.sub || req.ip,
  message: {
    message: `You have reached the hourly CV creation limit (${appConfig.rateLimits.cvCreationsPerHour}). Please try again later.`,
    code: "CV_CREATION_RATE_LIMIT_EXCEEDED",
  },
});

// Edit operations limiter - обмежує AI редагування
export const editOperationsLimiter = rateLimit({
  windowMs: appConfig.rateLimits.editOperationsWindowMs,
  max: appConfig.rateLimits.editOperationsPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.claims?.sub || req.ip,
  message: {
    message: `You have reached the hourly edit limit (${appConfig.rateLimits.editOperationsPerHour}). Please try again later.`,
    code: "EDIT_RATE_LIMIT_EXCEEDED",
  },
});
