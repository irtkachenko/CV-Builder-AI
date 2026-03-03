import type { Express, Request, Response } from "express";

interface AuthRequest extends Request {
  user: {
    claims: {
      sub: string;
      [key: string]: any;
    };
  };
}
import { storage } from "../storage";
import { api } from "@shared/routes";
import { appConfig } from "../config/app-config";
import { z } from "zod";
import { isAuthenticated } from "../replit_integrations/auth";
import { 
  aiRequestLimiter,
  fileUploadLimiter,
  cvCreationLimiter,
  editOperationsLimiter
} from "../middleware/rate-limit";
import { upload } from "../middleware/upload";
import { 
  processUploadedFile, 
  type UploadedFile 
} from "../services/file-service";
import { 
  validateCVContent, 
  generateUserFriendlyMessage, 
  formatSuggestionsForUser 
} from "../services/validation-service";
import { 
  generateCvAsync, 
  editCvAsync, 
  validateAiEditPrompt,
  validateGenerationPrompt,
  validateEditPrompt,
  parseModelTemperature,
  clampModelTemperature
} from "../services/cv-service";
import { 
  ValidationError,
  NotFoundError,
  ForbiddenError,
  FileProcessingError,
  asyncHandler
} from "../middleware/error-handler";
import { sanitizeHtmlContent } from "../middleware/input-sanitizer";

const MAX_ORIGINAL_DOC_TEXT_CHARS = 200_000;

function normalizeDocText(input: string): string {
  return input.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function truncateWithMarker(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[TRUNCATED]`;
}

function sanitizeOriginalLinks(rawLinks: any) {
  if (!Array.isArray(rawLinks)) return [];
  return rawLinks.slice(0, 50); // Simple truncation for now
}

export function registerCvRoutes(app: Express) {
  // Get all CV templates
  app.get(api.templates.list.path, isAuthenticated, asyncHandler(async (req: AuthRequest, res: Response) => {
    const templates = await storage.getTemplates();
    res.json(templates);
  }));

  // Start CV generation
  app.post(api.generate.start.path, isAuthenticated, fileUploadLimiter, cvCreationLimiter, aiRequestLimiter, upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user.claims.sub;

    // Handle file upload
    if (!req.file) {
      throw new ValidationError("❌ No file uploaded! Please select a .docx file to create your CV.", "file");
    }

    // Process uploaded file
    const fileResult = await processUploadedFile(req.file as UploadedFile);

    if (!fileResult.success) {
      let errorMessage = fileResult.error || "Failed to process file";

      // Add user-friendly messages for common errors
      if (errorMessage.includes("File must have .docx extension")) {
        errorMessage = "❌ Invalid file format! Please upload a .docx file (Microsoft Word).";
      } else if (errorMessage.includes("Invalid MIME type")) {
        errorMessage = "❌ Invalid file type! File must be a Microsoft Word document (.docx).";
      } else if (errorMessage.includes("File too large")) {
        errorMessage = "❌ File too large! Maximum size: 5MB.";
      } else if (errorMessage.includes("Empty file")) {
        errorMessage = "❌ File is empty! Please select a file with content.";
      } else if (errorMessage.includes("Failed to extract text")) {
        errorMessage = "❌ Failed to read file content! Please check that the file is not corrupted.";
      }

      throw new FileProcessingError(errorMessage);
    }

      const cvText = fileResult.text;
      const generationPromptRaw = typeof req.body.generationPrompt === "string" ? req.body.generationPrompt : "";
      const generationPrompt = generationPromptRaw.replace(/\u0000/g, "").trim();
      const generationTemperature = parseModelTemperature(
        req.body.temperature,
        appConfig.ai.defaultGenerationTemperature
      );

      // Validate generation prompt
      const promptValidation = validateGenerationPrompt(generationPrompt);
      if (!promptValidation.isValid) {
        return res.status(400).json({
          message: promptValidation.error,
          field: "generationPrompt"
        });
      }

      const originalDocText = truncateWithMarker(normalizeDocText(fileResult.text), appConfig.file.maxOriginalDocTextChars);
      const originalDocLinks = sanitizeOriginalLinks(fileResult.links || []);
      const sourceInfo = `Uploaded file: ${req.file.originalname}`;

      // Parse template ID first
      const templateId = parseInt(req.body.templateId);
      if (isNaN(templateId) || templateId <= 0) {
        return res.status(400).json({
          message: "❌ Invalid template ID! Please select a valid CV template.",
          field: "templateId"
        });
      }

      // 1. Validate CV content using AI FIRST (before creating anything in DB)
      const validationResult = await validateCVContent(cvText);

      if (!validationResult.isValid) {
        const userMessage = generateUserFriendlyMessage(validationResult);
        const suggestions = formatSuggestionsForUser(validationResult.suggestions || []);
        const fullMessage = userMessage + suggestions;

        return res.status(400).json({
          message: fullMessage,
          field: "file",
          validationDetails: {
            isValid: false,
            quality: validationResult.quality,
            issues: validationResult.issues
          }
        });
      }

      const userFriendlyStatus = generateUserFriendlyMessage(validationResult);

      // 2. ONLY NOW create the job in the database
      const cv = await storage.createGeneratedCv({
        userId,
        templateId,
        status: "processing",
        progress: userFriendlyStatus,
        originalDocText,
        originalDocLinks,
        name: req.file.originalname.replace(/\.[^/.]+$/, ""), // Remove file extension
      });

      // 3. Start async generation
      generateCvAsync(
        cv.id,
        templateId,
        cvText,
        sourceInfo,
        generationPrompt || undefined,
        generationTemperature
      ).catch(err => {
        // Failures are handled inside generateCvAsync
      });

      res.status(202).json({ jobId: cv.id });
  }));

  // Get generation status
  app.get(api.generate.status.path, isAuthenticated, async (req: any, res) => {
    try {
      const jobId = parseInt(req.params.jobId as string);
      if (Number.isNaN(jobId)) {
        return res.status(400).json({ message: "Invalid job id" });
      }
      const userId = req.user.claims.sub;
      const cv = await storage.getGeneratedCvWithTemplate(jobId);

      if (!cv) {
        return res.status(404).json({ message: 'Job not found' });
      }
      if (cv.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const response = {
        id: cv.id,
        status: cv.status as any,
        progress: cv.progress || undefined,
        pdfUrl: cv.pdfUrl || undefined,
        errorMessage: cv.errorMessage || undefined,
        template: cv.template,
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch job status" });
    }
  });

  // Get user's generated CVs
  app.get(api.resumes.list.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const cvs = await storage.getUserGeneratedCvs(userId);
      res.json(cvs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch resumes" });
    }
  });

  // Get individual CV for viewing
  app.get("/api/resumes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid CV id" });
      }
      const userId = req.user.claims.sub;

      const cv = await storage.getGeneratedCvWithTemplate(id);
      if (!cv) {
        return res.status(404).json({ message: 'CV not found' });
      }
      if (cv.userId !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      res.json(cv);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch CV" });
    }
  });

  // Start AI edit for existing generated CV
  app.post(api.resumes.aiEdit.path, isAuthenticated, editOperationsLimiter, aiRequestLimiter, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid CV id" });
      }

      const userId = req.user.claims.sub;
      const cv = await storage.getGeneratedCv(id);
      if (!cv) {
        return res.status(404).json({ message: "CV not found" });
      }
      if (cv.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (cv.status === "pending" || cv.status === "processing") {
        return res.status(409).json({ message: "CV is already processing" });
      }
      if (!cv.htmlContent) {
        return res.status(400).json({
          message: "This CV is not ready for AI editing yet.",
          code: "PROMPT_REJECTED",
          field: "prompt",
        });
      }

      const parsedBody = api.resumes.aiEdit.input.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({
          message: "Prompt is required",
          code: "PROMPT_REJECTED",
          field: "prompt",
        });
      }

      const prompt = parsedBody.data.prompt.replace(/\u0000/g, "").trim();
      const useOriginalDocumentContext = parsedBody.data.useOriginalDocumentContext ?? false;
      const editTemperature = clampModelTemperature(
        parsedBody.data.temperature ?? appConfig.ai.defaultEditTemperature
      );

      // Validate edit prompt
      const promptValidation = validateEditPrompt(prompt);
      if (!promptValidation.isValid) {
        return res.status(400).json({
          message: promptValidation.error,
          code: promptValidation.error?.includes("short") ? "PROMPT_TOO_SHORT" : "PROMPT_TOO_LONG",
          field: "prompt",
        });
      }

      const safetyCheck = await validateAiEditPrompt(prompt);
      if (!safetyCheck.allowed) {
        return res.status(400).json({
          message: safetyCheck.userMessage,
          code: "PROMPT_REJECTED",
          field: "prompt",
        });
      }

      if (useOriginalDocumentContext) {
        const hasOriginalDocText = Boolean(cv.originalDocText?.trim());
        const hasOriginalDocLinks = Array.isArray(cv.originalDocLinks) && cv.originalDocLinks.length > 0;
        if (!hasOriginalDocText && !hasOriginalDocLinks) {
          return res.status(400).json({
            message: "Original document context is unavailable for this CV.",
            code: "ORIGINAL_CONTEXT_UNAVAILABLE",
            field: "useOriginalDocumentContext",
          });
        }
      }

      await storage.updateGeneratedCvStatus(
        cv.id,
        "processing",
        "AI is editing your CV...",
        undefined,
        undefined,
        null
      );

      editCvAsync(cv.id, prompt, useOriginalDocumentContext, editTemperature).catch(() => {
        // Failures are handled inside editCvAsync
      });

      return res.status(202).json({ jobId: cv.id });
    } catch (error) {
      console.error("AI Edit Route Error:", error);
      return res.status(500).json({ message: "Failed to start AI edit" });
    }
  });

  // Render generated CV HTML from database
  app.get(api.generatedCv.render.path, isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid CV id" });
      }
      const userId = req.user.claims.sub;

      const cv = await storage.getGeneratedCv(id);
      if (!cv) {
        return res.status(404).json({ message: "CV not found" });
      }
      if (cv.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!cv.htmlContent) {
        return res.status(404).json({ message: "Generated CV HTML not found" });
      }

      const safeHtml = sanitizeHtmlContent(cv.htmlContent);
      
      // Security assertions from cv-service
      if (!safeHtml || !safeHtml.trim()) {
        return res.status(500).json({ message: "Generated HTML is empty" });
      }

      if (safeHtml.length > 500_000) {
        return res.status(500).json({ message: "Generated HTML exceeds maximum allowed size" });
      }

      const blockedPatterns = [
        /<script\b/i,
        /\son[a-z0-9_-]+\s*=/i,
        /javascript:/i,
        /vbscript:/i,
        /<iframe\b/i,
        /<object\b/i,
        /<embed\b/i,
        /<form\b/i,
        /<meta[^>]*http-equiv=["']?refresh/i,
      ];

      for (const pattern of blockedPatterns) {
        if (pattern.test(safeHtml)) {
          return res.status(500).json({ message: "Generated HTML failed security validation" });
        }
      }

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' data:; script-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:;"
      );
      res.send(safeHtml);
    } catch (error) {
      res.status(500).json({ message: "Failed to render CV" });
    }
  });

  // Delete a resume
  app.delete(api.resumes.delete.path, isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid CV id" });
      }
      const userId = req.user.claims.sub;

      // Verify ownership
      const cv = await storage.getGeneratedCv(id);
      if (!cv) {
        return res.status(404).json({ message: 'Resume not found' });
      }
      if (cv.userId !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      await storage.deleteGeneratedCv(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete resume" });
    }
  });
}
