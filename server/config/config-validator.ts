import { z } from "zod";
import { ValidationError } from "../middleware/error-handler";

// Схеми валідації для environment variables
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  
  // AI Configuration
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  
  // Rate Limits
  AI_REQUESTS_PER_HOUR: z.string().regex(/^\d+$/, "AI_REQUESTS_PER_HOUR must be a number").optional(),
  AI_REQUEST_WINDOW_MS: z.string().regex(/^\d+$/, "AI_REQUEST_WINDOW_MS must be a number").optional(),
  
  // File Configuration
  AI_MAX_GENERATED_HTML_CHARS: z.string().regex(/^\d+$/, "AI_MAX_GENERATED_HTML_CHARS must be a number").optional(),
  
  // AI Temperature
  AI_VALIDATION_TEMPERATURE: z.string().regex(/^\d+(\.\d+)?$/, "AI_VALIDATION_TEMPERATURE must be a number").optional(),
  
  // Environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  
  // Server Configuration
  PORT: z.string().regex(/^\d+$/, "PORT must be a number").optional(),
  
  // Security
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  
  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  
  // Cache Configuration
  CACHE_TTL_SECONDS: z.string().regex(/^\d+$/, "CACHE_TTL_SECONDS must be a number").optional(),
  CACHE_MAX_SIZE: z.string().regex(/^\d+$/, "CACHE_MAX_SIZE must be a number").optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export class ConfigValidator {
  private static instance: ConfigValidator;
  private config: EnvConfig;
  private validated = false;

  private constructor() {
    this.config = {} as EnvConfig;
  }

  static getInstance(): ConfigValidator {
    if (!ConfigValidator.instance) {
      ConfigValidator.instance = new ConfigValidator();
    }
    return ConfigValidator.instance;
  }

  validate(): EnvConfig {
    if (this.validated) {
      return this.config;
    }

    try {
      // Валідація environment variables
      this.config = envSchema.parse(process.env);
      this.validated = true;

      // Додаткові перевірки
      this.performAdditionalValidations();

      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        throw new ValidationError(`Configuration validation failed: ${errors}`);
      }
      throw error;
    }
  }

  private performAdditionalValidations(): void {
    // Перевірка критичних налаштувань для production
    if (this.config.NODE_ENV === "production") {
      this.validateProductionConfig();
    }

    // Перевірка AI API ключа
    this.validateAIConfig();

    // Перевірка URL бази даних
    this.validateDatabaseConfig();
  }

  private validateProductionConfig(): void {
    const issues: string[] = [];

    // JWT Secret обов'язковий в production
    if (!this.config.JWT_SECRET || this.config.JWT_SECRET.length < 32) {
      issues.push("JWT_SECRET must be at least 32 characters in production");
    }

    // Перевірка LOG_LEVEL
    if (this.config.LOG_LEVEL === "debug") {
      console.warn("⚠️  Debug logging is not recommended in production");
    }

    if (issues.length > 0) {
      throw new ValidationError(`Production configuration issues: ${issues.join(', ')}`);
    }
  }

  private validateAIConfig(): void {
    if (!this.config.OPENROUTER_API_KEY) {
      throw new ValidationError("OPENROUTER_API_KEY is required for AI functionality");
    }

    // Перевірка формату API ключа
    if (!this.config.OPENROUTER_API_KEY.startsWith('sk-or-v1-')) {
      console.warn("⚠️  OPENROUTER_API_KEY format may be incorrect");
    }
  }

  private validateDatabaseConfig(): void {
    if (!this.config.DATABASE_URL) {
      throw new ValidationError("DATABASE_URL is required");
    }

    // Базова перевірка формату URL
    try {
      const url = new URL(this.config.DATABASE_URL);
      if (!url.protocol || !url.hostname) {
        throw new ValidationError("DATABASE_URL format is invalid");
      }
    } catch {
      throw new ValidationError("DATABASE_URL format is invalid");
    }
  }

  // Перевірка налаштувань під час runtime
  validateRuntimeConfig(): void {
    const issues: string[] = [];

    // Перевірка доступності сервісів
    this.checkServiceAvailability(issues);

    // Перевірка ресурсів
    this.checkResourceAvailability(issues);

    if (issues.length > 0) {
      console.warn("⚠️  Runtime configuration issues:", issues);
    }
  }

  private checkServiceAvailability(issues: string[]): void {
    // Перевірка доступності бази даних
    try {
      const { db } = require("../db");
      // Базова перевірка - не блокуємо якщо не працює
      // Це буде перевірено в health checks
    } catch (error) {
      issues.push("Database connection may be unavailable");
    }
  }

  private checkResourceAvailability(issues: string[]): void {
    const memoryUsage = process.memoryUsage();
    const maxMemory = 1024 * 1024 * 1024; // 1GB

    if (memoryUsage.heapUsed > maxMemory * 0.8) {
      issues.push("Memory usage is high (>80% of 1GB)");
    }

    // Перевірка доступного місця на диску (базова)
    try {
      const fs = require('fs');
      const stats = fs.statSync('.');
      // Це дуже базова перевірка, в реальності потрібна складніша
    } catch (error) {
      // Ігноруємо помилки файлової системи
    }
  }

  // Отримання конфігурації з типами
  getConfig(): EnvConfig {
    if (!this.validated) {
      throw new ValidationError("Configuration not validated. Call validate() first.");
    }
    return this.config;
  }

  // Отримання конкретного значення з default
  get(key: keyof EnvConfig): string {
    return this.getConfig()[key] || '';
  }

  // Перевірка чи це production
  isProduction(): boolean {
    return this.getConfig().NODE_ENV === "production";
  }

  // Перевірка чи це development
  isDevelopment(): boolean {
    return this.getConfig().NODE_ENV === "development";
  }
}

// Експорт singleton
export const configValidator = ConfigValidator.getInstance();
