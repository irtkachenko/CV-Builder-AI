import mammoth from "mammoth";
import { appConfig } from "../config/app-config";
import type { OriginalDocLink } from "@shared/schema";

import { docxFileSchema } from "@shared/routes";
import { sanitizeField, sanitizeHtmlContent } from "../middleware/input-sanitizer";

const MAX_LINK_TEXT_LENGTH = appConfig.security.maxLinkTextLength;
const MAX_LINK_HREF_LENGTH = appConfig.security.maxLinkHrefLength;
const MAX_LINKS_COUNT = appConfig.security.maxLinksCount;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function sanitizeHref(rawHref: string): string | null {
  const decoded = decodeBasicEntities(rawHref).replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!decoded) return null;
  if (decoded.length > MAX_LINK_HREF_LENGTH) return null;

  const lowered = decoded.toLowerCase();
  if (lowered.startsWith("javascript:") || lowered.startsWith("vbscript:") || lowered.startsWith("data:")) {
    return null;
  }

  if (lowered.startsWith("mailto:") || lowered.startsWith("tel:")) {
    return decoded;
  }

  try {
    const parsed = new URL(decoded);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeLink(rawText: string, rawHref: string): OriginalDocLink | null {
  const href = sanitizeHref(rawHref);
  if (!href) return null;

  const text = normalizeWhitespace(sanitizeField(decodeBasicEntities(rawText))).slice(0, MAX_LINK_TEXT_LENGTH);
  return { text, href };
}

function extractLinksFromHtml(html: string): OriginalDocLink[] {
  const links: OriginalDocLink[] = [];
  const dedupe = new Set<string>();
  const anchorRegex = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1] || match[2] || match[3] || "";
    const anchorText = match[4] || "";
    const sanitized = sanitizeLink(anchorText, href);
    if (!sanitized) continue;

    const dedupeKey = `${sanitized.text}|${sanitized.href}`;
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);

    links.push(sanitized);
    if (links.length >= MAX_LINKS_COUNT) break;
  }

  return links;
}

// Define file interface
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

// Validate uploaded file
export function validateUploadedFile(file: UploadedFile): {
  isValid: boolean;
  error?: string;
} {
  try {
    const result = docxFileSchema.safeParse({
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
      lastModified: Date.now(),
    });

    if (!result.success) {
      const issue = result.error.issues[0];
      return {
        isValid: false,
        error: issue?.message || "Invalid file format",
      };
    }

    // Additional check: file extension
    if (!file.originalname.toLowerCase().endsWith(".docx")) {
      return {
        isValid: false,
        error: "File must have .docx extension",
      };
    }

    return { isValid: true };
  } catch {
    return {
      isValid: false,
      error: "File validation failed",
    };
  }
}

// Extract text from .docx file using mammoth
export async function extractTextFromDocx(buffer: Buffer): Promise<{
  text: string;
  links: OriginalDocLink[];
  success: boolean;
  error?: string;
}> {
  try {
    const textResult = await mammoth.extractRawText({ buffer });
    let links: OriginalDocLink[] = [];

    try {
      const htmlResult = await mammoth.convertToHtml({ buffer });
      links = extractLinksFromHtml(htmlResult.value || "");
    } catch (linksError) {
      // Link extraction is best-effort and must not fail full processing
      links = [];
    }

    return {
      text: textResult.value,
      links,
      success: true,
    };
  } catch (error) {
    console.error("Error extracting text from docx:", error);
    return {
      text: "",
      links: [],
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract text from file",
    };
  }
}

// Process uploaded file and extract text + links
export async function processUploadedFile(file: UploadedFile): Promise<{
  text: string;
  links: OriginalDocLink[];
  success: boolean;
  error?: string;
}> {
  // First validate the file
  const validation = validateUploadedFile(file);
  if (!validation.isValid) {
    return {
      text: "",
      links: [],
      success: false,
      error: validation.error,
    };
  }

  return extractTextFromDocx(file.buffer);
}
