import { configValidator } from "../config/config-validator";
import { logger } from "../services/logger-service";
import { ValidationError } from "./error-handler";

export interface StartupValidationResult {
  success: boolean;
  issues: string[];
  warnings: string[];
  environment: string;
  timestamp: string;
}

export class StartupValidator {
  static async validate(): Promise<StartupValidationResult> {
    const result: StartupValidationResult = {
      success: true,
      issues: [],
      warnings: [],
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    };

    logger.info("Starting application validation...");

    try {
      // 1. Валідація environment variables
      await this.validateEnvironment(result);
      
      // 2. Валідація сервісів
      await this.validateServices(result);
      
      // 3. Валідація ресурсів
      await this.validateResources(result);
      
      // 4. Валідація безпеки
      await this.validateSecurity(result);

      // 5. Валідація продуктивності
      await this.validatePerformance(result);

      // Якщо є критичні проблеми, помічаємо як невдачу
      if (result.issues.length > 0) {
        result.success = false;
        logger.error("Startup validation failed", { issues: result.issues });
      } else {
        logger.info("Startup validation completed successfully", { 
          warnings: result.warnings.length,
          environment: result.environment
        });
      }

      return result;
    } catch (error) {
      logger.error("Startup validation error", { error });
      result.success = false;
      result.issues.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }

  private static async validateEnvironment(result: StartupValidationResult): Promise<void> {
    try {
      configValidator.validate();
      logger.info("Environment variables validated successfully");
    } catch (error) {
      if (error instanceof ValidationError) {
        result.issues.push(error.message);
      } else {
        result.issues.push(`Environment validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private static async validateServices(result: StartupValidationResult): Promise<void> {
    // Валідація бази даних
    try {
      const { db } = require("../db");
      await db.execute('SELECT 1');
      logger.info("Database connection validated");
    } catch (error) {
      result.issues.push(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Валідація AI API ключа
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        result.issues.push("OPENROUTER_API_KEY is not set");
      } else if (!apiKey.startsWith('sk-or-v1-')) {
        result.warnings.push("OPENROUTER_API_KEY format may be incorrect");
      }
      logger.info("AI API key validated");
    } catch (error) {
      result.warnings.push(`AI API validation warning: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static async validateResources(result: StartupValidationResult): Promise<void> {
    const memoryUsage = process.memoryUsage();
    const maxMemory = 1024 * 1024 * 1024; // 1GB

    // Перевірка використання пам'яті
    if (memoryUsage.heapUsed > maxMemory * 0.8) {
      result.warnings.push(`High memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB (>80% of 1GB)`);
    }

    // Перевірка доступного місця на диску (базова)
    try {
      const fs = require('fs');
      const stats = fs.statSync('.');
      const freeSpace = require('os').freemem();
      
      if (freeSpace < 100 * 1024 * 1024) { // 100MB
        result.warnings.push("Low available system memory");
      }
      
      logger.info("Resource validation completed", {
        memory: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
        freeMemory: Math.round(freeSpace / 1024 / 1024) + 'MB'
      });
    } catch (error) {
      result.warnings.push(`Resource validation warning: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static async validateSecurity(result: StartupValidationResult): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // Перевірка JWT_SECRET
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret || jwtSecret.length < 32) {
        result.issues.push("JWT_SECRET must be at least 32 characters in production");
      }

      // Перевірка HTTPS (базова)
      if (!process.env.HTTPS_REQUIRED) {
        result.warnings.push("HTTPS not explicitly required in production");
      }

      // Перевірка логування
      if (process.env.LOG_LEVEL === 'debug') {
        result.warnings.push("Debug logging is not recommended in production");
      }
    }

    logger.info("Security validation completed");
  }

  private static async validatePerformance(result: StartupValidationResult): Promise<void> {
    // Перевірка Node.js версії
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 18) {
      result.warnings.push(`Node.js version ${nodeVersion} is outdated (recommended: >=18)`);
    }

    // Перевірка worker threads
    if (typeof require('worker_threads').isMainThread === 'undefined') {
      result.warnings.push("Worker threads may not be available");
    }

    logger.info("Performance validation completed", {
      nodeVersion,
      platform: process.platform,
      arch: process.arch
    });
  }

  // Функція для graceful shutdown якщо валідація не пройшла
  static async handleValidationFailure(result: StartupValidationResult): Promise<void> {
    logger.error("Application startup failed", result);
    
    console.error("\n❌ APPLICATION STARTUP FAILED");
    console.error("=====================================");
    
    if (result.issues.length > 0) {
      console.error("\n🚨 Critical Issues:");
      result.issues.forEach((issue, index) => {
        console.error(`${index + 1}. ${issue}`);
      });
    }
    
    if (result.warnings.length > 0) {
      console.error("\n⚠️  Warnings:");
      result.warnings.forEach((warning, index) => {
        console.error(`${index + 1}. ${warning}`);
      });
    }
    
    console.error("\n💡 Please fix the issues above and restart the application");
    console.error("📖 Check documentation: https://docs.example.com/configuration\n");
    
    // Graceful shutdown
    process.exit(1);
  }
}

// Middleware для валідації при старті
export const validateStartup = async (): Promise<void> => {
  const result = await StartupValidator.validate();
  
  if (!result.success) {
    await StartupValidator.handleValidationFailure(result);
  }
  
  // Runtime validation (періодична)
  setInterval(() => {
    configValidator.validateRuntimeConfig();
  }, 5 * 60 * 1000); // Кожні 5 хвилин
};
