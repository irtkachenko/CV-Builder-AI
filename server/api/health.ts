import type { Express, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler";
import { db } from "../db";
import { appConfig } from "../config/app-config";
import { configValidator } from "../config/config-validator";
import { createLogger } from "../services/logger-service";

const logger = createLogger('HEALTH');

interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: 'ok' | 'error';
    configuration: 'ok' | 'error';
    memory: NodeJS.MemoryUsage;
    environment: string;
  };
}

export function registerHealthRoutes(app: Express): void {
  // Health check endpoint
  app.get('/health', asyncHandler(async (req: Request, res: Response) => {
    const health: HealthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: await checkDatabaseHealth(),
        configuration: await checkConfigurationHealth(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
      }
    };

    // If any service is down, return 503
    const hasErrors = Object.values(health.services).some(
      service => typeof service === 'string' && service === 'error'
    );

    if (hasErrors) {
      health.status = 'error';
      return res.status(503).json(health);
    }

    res.json(health);
  }));

  // Simple ping endpoint
  app.get('/ping', (req: Request, res: Response) => {
    res.json({
      message: 'pong',
      timestamp: new Date().toISOString()
    });
  });

  // Readiness check for Kubernetes/Docker
  app.get('/ready', asyncHandler(async (req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();
    
    if (dbHealth === 'error') {
      return res.status(503).json({
        status: 'not ready',
        reason: 'database not available'
      });
    }

    res.json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  }));

  // Liveness check for Kubernetes/Docker
  app.get('/live', (req: Request, res: Response) => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString()
    });
  });
}

async function checkDatabaseHealth(): Promise<'ok' | 'error'> {
  try {
    // Simple health check - try to execute a query
    await db.execute('SELECT 1');
    return 'ok';
  } catch (error) {
    logger.error('Database health check failed', { error });
    return 'error';
  }
}

async function checkConfigurationHealth(): Promise<'ok' | 'error'> {
  try {
    // Check if configuration is validated
    configValidator.getConfig();
    return 'ok';
  } catch (error) {
    logger.error('Configuration health check failed', { error });
    return 'error';
  }
}
