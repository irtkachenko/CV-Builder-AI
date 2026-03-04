import OpenAI from 'openai';
import { storage } from "../storage";
import { db } from "../db";
import { createLogger } from "./logger-service";
import { validateSecurity, XSS_PATTERNS, HTML_PATTERNS } from "./security-validation";
import { appConfig } from "../config/app-config";
import { replacePromptPlaceholders } from "../utils/prompt-utils";
import { clampModelTemperature, parseModelTemperature } from "../utils/temperature-utils";
import { validateGenerationPrompt, validateEditPrompt } from "../utils/validation-utils";
import { sanitizeOriginalLinks } from "../utils/file-utils";
import type { OriginalDocLink } from "@shared/schema";
import { z } from "zod";
import { sanitizeHtmlContent } from "../middleware/input-sanitizer";
import { api, buildUrl } from "@shared/routes";
import { 
  detectHallucinations, 
  checkLogicalConsistency, 
  shouldRejectContent, 
  generateHallucinationMessage,
  filterSuspiciousContent 
} from "./hallucination-filter";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

const logger = createLogger('CV_SERVICE');

// OpenRouter client using Replit AI Integrations (includes Groq/Llama models)
const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

const AI_MODEL = appConfig.ai.model;
const AI_EDIT_PROMPT_MIN_LENGTH = appConfig.ai.editPromptMinLength;
const AI_EDIT_PROMPT_MAX_LENGTH = appConfig.ai.editPromptMaxLength;
const GENERATION_PROMPT_MAX_LENGTH = appConfig.ai.generationPromptMaxLength;
const MAX_GENERATED_HTML_CHARS = appConfig.html.maxGeneratedHtmlChars;
const MAX_ORIGINAL_DOC_TEXT_CHARS = appConfig.file.maxOriginalDocTextChars;
const MAX_ORIGINAL_CONTEXT_PROMPT_CHARS = appConfig.file.maxOriginalContextPromptChars;
const MAX_ORIGINAL_CONTEXT_LINKS = appConfig.file.maxOriginalContextLinks;

// === HELPER FUNCTIONS ===

function cleanModelHtmlResponse(raw: string): string {
  return raw
    .replace(/```html\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
}

function normalizeDocText(input: string): string {
  return input.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function truncateWithMarker(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[TRUNCATED]`;
}

function isAllowedContextHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
}

function buildOriginalContextPromptBlock(originalDocText?: string | null, originalDocLinks?: unknown): string {
  const safeText = originalDocText ? truncateWithMarker(normalizeDocText(originalDocText), MAX_ORIGINAL_CONTEXT_PROMPT_CHARS) : "";
  const safeLinks = sanitizeOriginalLinks(originalDocLinks).slice(0, MAX_ORIGINAL_CONTEXT_LINKS);

  const linksSection = safeLinks.length
    ? safeLinks.map((link, index) => `${index + 1}. ${link.text || "(no anchor text)"} -> ${link.href}`).join("\n")
    : "No sanitized links available.";

  const combined = `ORIGINAL_DOC_TEXT:
${safeText || "No original text available."}

ORIGINAL_DOC_LINKS:
${linksSection}`;

  return truncateWithMarker(combined, MAX_ORIGINAL_CONTEXT_PROMPT_CHARS);
}

function assertSafeGeneratedHtml(html: string) {
  if (!html || !html.trim()) {
    throw new Error("Generated HTML is empty");
  }

  if (html.length > MAX_GENERATED_HTML_CHARS) {
    throw new Error("Generated HTML exceeds maximum allowed size");
  }

  // Use centralized security validation
  const securityValidation = validateSecurity(html);
  if (!securityValidation.isValid) {
    throw new Error("Generated HTML failed security validation");
  }
}

interface PromptSafetyResult {
  allowed: boolean;
  reason: string;
  userMessage: string;
}

function extractFirstJsonObject(raw: string): string {
  const startIndex = raw.indexOf("{");
  const endIndex = raw.lastIndexOf("}");
  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    throw new Error("No valid JSON object found");
  }
  return raw.substring(startIndex, endIndex + 1);
}

function runLocalPromptSafetyChecks(prompt: string): PromptSafetyResult {
  const lowered = prompt.toLowerCase();

  const blockedRuleChecks: Array<{ pattern: RegExp; reason: string; userMessage: string }> = [
    {
      pattern: /ignore\s+(all|any|previous|prior)\s+instructions/i,
      reason: "jailbreak_override",
      userMessage: "Your request was rejected due to unsafe instruction override attempts.",
    },
    {
      pattern: /(show|reveal|print)\s+(system|hidden)\s+prompt/i,
      reason: "prompt_exfiltration",
      userMessage: "Your request was rejected due to unsafe prompt-extraction instructions.",
    },
    {
      pattern: new RegExp(`(${XSS_PATTERNS.map(p => p.source).join('|')})`, 'i'),
      reason: "script_injection",
      userMessage: "Your request was rejected due to potential code injection.",
    },
    {
      pattern: /(self-harm|suicide|kill|bomb|explosive|weapon|terror)/i,
      reason: "harmful_content",
      userMessage: "Your request contains unsafe content and cannot be processed.",
    },
    {
      pattern: /(hate speech|racial slur|ethnic cleansing|genocide|sexual violence|rape)/i,
      reason: "abusive_content",
      userMessage: "Your request contains unsafe content and cannot be processed.",
    },
  ];

  for (const check of blockedRuleChecks) {
    if (check.pattern.test(lowered)) {
      return {
        allowed: false,
        reason: check.reason,
        userMessage: check.userMessage,
      };
    }
  }

  return {
    allowed: true,
    reason: "passed_local_rules",
    userMessage: "",
  };
}

async function runAiPromptModeration(prompt: string): Promise<PromptSafetyResult> {
  const moderationPrompt = replacePromptPlaceholders(appConfig.prompts.safetyModeration.userPrompt, {
    prompt
  });

  const response = await openrouter.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content: appConfig.prompts.safetyModeration.systemPrompt,
      },
      { role: "user", content: moderationPrompt },
    ],
    max_tokens: 512,
    temperature: appConfig.ai.validationTemperature,
  });

  const rawContent = response.choices[0]?.message?.content || "";
  const json = extractFirstJsonObject(rawContent);
  const parsed = JSON.parse(json) as Partial<PromptSafetyResult>;

  if (typeof parsed.allowed !== "boolean") {
    throw new Error("Invalid moderation JSON schema: missing 'allowed'");
  }

  return {
    allowed: parsed.allowed,
    reason: typeof parsed.reason === "string" ? parsed.reason : parsed.allowed ? "allowed_by_moderation" : "blocked_by_moderation",
    userMessage: typeof parsed.userMessage === "string"
      ? parsed.userMessage
      : parsed.allowed
        ? "Request accepted."
        : "Your request cannot be processed due to safety policy.",
  };
}

// === MAIN SERVICE FUNCTIONS ===

export async function validateAiEditPrompt(prompt: string): Promise<PromptSafetyResult> {
  const localSafety = runLocalPromptSafetyChecks(prompt);
  if (!localSafety.allowed) {
    return localSafety;
  }

  try {
    return await runAiPromptModeration(prompt);
  } catch (error) {
    console.error("AI moderation error:", error);
    return {
      allowed: false,
      reason: "moderation_unavailable",
      userMessage: "Your request cannot be processed right now. Please rephrase and try again.",
    };
  }
}

export async function generateCvAsync(
  jobId: number,
  templateId: number,
  cvText: string,
  sourceInfo?: string,
  additionalUserPrompt?: string,
  modelTemperature: number = appConfig.ai.defaultGenerationTemperature
) {
  try {
    const template = await storage.getTemplate(templateId);
    if (!template) {
      throw new Error("Template not found in DB");
    }

    const templatePath = path.join(process.cwd(), "client", "public", "templates", template.fileName);

    if (!fsSync.existsSync(templatePath)) {
      throw new Error(`Template file ${template.fileName} not found in templates directory`);
    }

    const templateHtml = await fs.readFile(templatePath, "utf-8");
    const normalizedCvText = cvText.replace(/\u0000/g, "").trim();

    await storage.updateGeneratedCvStatus(
      jobId,
      "processing",
      "AI is analyzing and formatting your CV..."
    );

    const systemMessage = appConfig.prompts.generation.systemPrompt;

    const generationPrompt = replacePromptPlaceholders(appConfig.prompts.generation.userPrompt, {
      sourceInfo: sourceInfo || "N/A",
      additionalUserPrompt: additionalUserPrompt || "None",
      templateHtml,
      normalizedCvText
    });

    try {
      const response = await openrouter.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: generationPrompt },
        ],
        max_tokens: 8192,
        temperature: clampModelTemperature(modelTemperature),
      });

      let generatedHtml = cleanModelHtmlResponse(response.choices[0]?.message?.content || "");
      if (!generatedHtml) {
        throw new Error("AI returned empty HTML");
      }

      // Sanitize HTML before saving
      generatedHtml = sanitizeHtmlContent(generatedHtml).trim();
      assertSafeGeneratedHtml(generatedHtml);

      // Apply hallucination filtering
      await storage.updateGeneratedCvStatus(
        jobId,
        "processing",
        "Verifying content accuracy..."
      );

      const hallucinationResult = await detectHallucinations(normalizedCvText, generatedHtml);
      const consistencyResult = await checkLogicalConsistency(generatedHtml);

      // Check if content should be rejected
      if (shouldRejectContent(hallucinationResult)) {
        await storage.updateGeneratedCvStatus(
          jobId,
          "failed",
          generateHallucinationMessage(hallucinationResult),
          undefined,
          undefined,
          "Content verification failed. Please check your original document for accuracy."
        );
        return;
      }

      // Apply content filtering if needed
      let finalHtml = generatedHtml;
      if (hallucinationResult.isHallucinated && hallucinationResult.issues.length > 0) {
        finalHtml = filterSuspiciousContent(generatedHtml, hallucinationResult.issues);
        logger.info('Applied content filtering', { 
          originalLength: generatedHtml.length,
          filteredLength: finalHtml.length,
          issuesCount: hallucinationResult.issues.length
        });
      }

      const pdfUrl = buildUrl(api.generatedCv.render.path, { id: jobId });
      const statusMessage = consistencyResult.isConsistent && !hallucinationResult.isHallucinated
        ? "CV successfully created and verified!"
        : "CV created with content warnings. Please review for accuracy.";

      await storage.updateGeneratedCvStatus(
        jobId,
        "complete",
        statusMessage,
        pdfUrl,
        finalHtml,
        null
      );
    } catch (apiError: any) {
      console.error("AI Generation Error:", apiError.message);
      await storage.updateGeneratedCvStatus(
        jobId,
        "failed",
        "AI generation failed"
      );
    }
  } catch (error: any) {
    console.error("Critical CV Generation Error:", error.message);
    await storage.updateGeneratedCvStatus(
      jobId,
      "failed",
      "Critical generation error"
    );
  }
}

export async function editCvAsync(
  cvId: number,
  userPrompt: string,
  useOriginalDocumentContext: boolean,
  modelTemperature: number = appConfig.ai.defaultEditTemperature
) {
  try {
    const cv = await storage.getGeneratedCv(cvId);
    if (!cv || !cv.htmlContent) {
      throw new Error("Generated CV HTML not found");
    }

    const originalContextBlock = useOriginalDocumentContext
      ? buildOriginalContextPromptBlock(cv.originalDocText, cv.originalDocLinks)
      : "Original document context disabled by user.";

    const systemMessage = appConfig.prompts.editing.systemPrompt;

    const editPrompt = replacePromptPlaceholders(appConfig.prompts.editing.userPrompt, {
      userPrompt,
      originalContextBlock,
      cvHtmlContent: cv.htmlContent
    });

    const response = await openrouter.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: editPrompt },
      ],
      max_tokens: 8192,
      temperature: clampModelTemperature(modelTemperature),
    });

    let editedHtml = cleanModelHtmlResponse(response.choices[0]?.message?.content || "");
    if (!editedHtml) {
      throw new Error("AI returned empty HTML during edit");
    }

    const wasSameAsOriginal = editedHtml.trim() === cv.htmlContent.trim();
    editedHtml = sanitizeHtmlContent(editedHtml).trim();
    if (!editedHtml) {
      throw new Error("Sanitized edited HTML is empty");
    }

    assertSafeGeneratedHtml(editedHtml);

    // Apply hallucination filtering to edited content
    await storage.updateGeneratedCvStatus(
      cvId,
      "processing",
      "Verifying edited content accuracy..."
    );

    const hallucinationResult = await detectHallucinations(cv.originalDocText || "", editedHtml);
    const consistencyResult = await checkLogicalConsistency(editedHtml);

    // Check if edited content should be rejected
    if (shouldRejectContent(hallucinationResult)) {
      await storage.updateGeneratedCvStatus(
        cvId,
        "complete",
        "AI edit failed due to content verification issues. Showing previous version.",
        undefined,
        undefined,
        "Edit contains potentially inaccurate information. Please try a different approach."
      );
      return;
    }

    // Apply content filtering if needed
    let finalEditedHtml = editedHtml;
    if (hallucinationResult.isHallucinated && hallucinationResult.issues.length > 0) {
      finalEditedHtml = filterSuspiciousContent(editedHtml, hallucinationResult.issues);
      logger.info('Applied content filtering to edited CV', { 
        originalLength: editedHtml.length,
        filteredLength: finalEditedHtml.length,
        issuesCount: hallucinationResult.issues.length
      });
    }

    if (wasSameAsOriginal) {
      await storage.updateGeneratedCvStatus(
        cvId,
        "complete",
        "AI edit did not change CV. Showing previous version.",
        undefined,
        undefined,
        "AI did not apply visible changes. Try a more specific prompt."
      );
      return;
    }

    const pdfUrl = buildUrl(api.generatedCv.render.path, { id: cvId });
    const statusMessage = consistencyResult.isConsistent && !hallucinationResult.isHallucinated
      ? "CV successfully updated and verified!"
      : "CV updated with content warnings. Please review for accuracy.";

    await storage.updateGeneratedCvStatus(
      cvId,
      "complete",
      statusMessage,
      pdfUrl,
      finalEditedHtml,
      null
    );
  } catch (error: any) {
    console.error("AI Edit Error:", error);
    await storage.updateGeneratedCvStatus(
      cvId,
      "complete",
      "AI edit failed. Showing previous version.",
      undefined,
      undefined,
      "Failed to edit CV with AI. Please try again."
    );
  }
}

// Template management functions
export function extractTemplateTitle(htmlContent: string): string {
  const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleMatch) return 'Untitled Template';
  
  let title = titleMatch[1].trim();
  // Remove "CV - " prefix if present
  if (title.startsWith('CV - ')) {
    title = title.replace('CV - ', '');
  }
  return title;
}

export function extractTemplateDescription(htmlContent: string): string | null {
  const descMatch = htmlContent.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return descMatch ? descMatch[1].trim() : null;
}

export async function seedTemplates() {
  const existing = await storage.getTemplates();
  logger.info('Template synchronization: checking templates...');

  // Auto-generate templates from files in templates directory
  const templatesDir = path.join(process.cwd(), "client", "public", "templates");
  const templateFiles = fsSync.readdirSync(templatesDir).filter(file => file.endsWith('.html'));
  
  const templates = templateFiles.map((fileName) => {
    const templateNumber = fileName.replace('.html', '');
    const templateId = parseInt(templateNumber.split('-')[1]); // Extract number from template-X
    
    // Read HTML content to extract title and description
    const templatePath = path.join(templatesDir, fileName);
    const htmlContent = fsSync.readFileSync(templatePath, 'utf-8');
    const templateTitle = extractTemplateTitle(htmlContent);
    const templateDescription = extractTemplateDescription(htmlContent);

    return {
      id: templateId,
      name: templateTitle,
      fileName: fileName, // Use actual filename without hash
      screenshotUrl: `/images/templates/${fileName.replace('.html', '.png')}`,
      description: templateDescription || `${templateTitle} description`
    };
  });

  // Find templates that need to be added
  const existingFileNames = existing.map(t => t.fileName);
  const templatesToAdd = templates.filter(t => !existingFileNames.includes(t.fileName));
  
  // Find templates that should be removed (not in files anymore)
  const requiredFileNames = templates.map(t => t.fileName);
  const templatesToRemove = existing.filter(t => !requiredFileNames.includes(t.fileName));

  if (templatesToAdd.length > 0 || templatesToRemove.length > 0) {
    logger.info(`Templates: adding ${templatesToAdd.length}, removing ${templatesToRemove.length}`);
  }

  // Add new templates
  for (const template of templatesToAdd) {
    await storage.createTemplate(template);
    logger.info(`✓ Added template: ${template.name}`);
  }

  // Remove obsolete templates (will also delete related CVs)
  for (const template of templatesToRemove) {
    await storage.deleteTemplate(template.id);
    logger.info(`✓ Removed template: ${template.name}`);
  }
}

// Re-export utilities from utils for backward compatibility
export { parseModelTemperature, clampModelTemperature } from "../utils/temperature-utils";
export { validateGenerationPrompt, validateEditPrompt } from "../utils/validation-utils";
export { sanitizeOriginalLinks } from "../utils/file-utils";
