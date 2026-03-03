import type { Express } from "express";
import { setupAuth, registerAuthRoutes as registerReplitAuthRoutes } from "../replit_integrations/auth";

export async function registerAuthRoutes(app: Express) {
  // Setup authentication first
  await setupAuth(app);
  
  // Register auth routes (this function comes from replit_integrations/auth)
  registerReplitAuthRoutes(app);
}
