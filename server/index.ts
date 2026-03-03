import express, { type Request, Response, NextFunction } from "express";
import { registerApiRoutes } from "./api";
import { serveStatic } from "./static";
import { createServer } from "http";
import rateLimit from "express-rate-limit";
import { appConfig } from "./config/app-config";
import { globalErrorHandler, notFoundHandler, setupErrorHandlers } from "./middleware/error-handler";
import { validateStartup } from "./middleware/startup-validation";
import { logger } from "./services/logger-service";
import { inputSanitizerMiddleware, htmlSanitizerMiddleware } from "./middleware/input-sanitizer";
import { getSecurityMiddleware } from "./middleware/security-headers";

const app = express();
const httpServer = createServer(app);
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

const apiLimiter = rateLimit({
  windowMs: appConfig.rateLimits.apiRequestsWindowMs,
  max: appConfig.rateLimits.apiRequestsPer15Minutes,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

app.use("/api", apiLimiter);

// Security headers middleware
app.use(getSecurityMiddleware());

// Input sanitization middleware
app.use(inputSanitizerMiddleware);
app.use(htmlSanitizerMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logMessage = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logMessage += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      logger.info(logMessage, {
        method: req.method,
        path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }
  });

  next();
});

(async () => {
  // 1. Validate startup configuration first
  await validateStartup();

  // 2. Setup error handlers
  setupErrorHandlers();

  // 3. Register API routes
  await registerApiRoutes(app);

  // 4. Setup 404 and error handlers
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  // 5. Setup development or production server
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      logger.info(`Server ready on port ${port}`, { port });
    },
  );
})();
