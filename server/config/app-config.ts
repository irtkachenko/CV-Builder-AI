import { configValidator } from "./config-validator";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseBoundedFloat(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

export const appConfig = {
  rateLimits: {
    apiRequestsPer15Minutes: 200,
    apiRequestsWindowMs: 15 * 60 * 1000,
    aiRequestsPerHour: parsePositiveInt(process.env.AI_REQUESTS_PER_HOUR, 20),
    aiRequestsWindowMs: parsePositiveInt(process.env.AI_REQUEST_WINDOW_MS, 60 * 60 * 1000),
    fileUploadsPerMinute: 5,
    fileUploadsWindowMs: 60 * 1000,
    cvCreationsPerHour: 10,
    cvCreationsWindowMs: 60 * 60 * 1000,
    editOperationsPerHour: 25,
    editOperationsWindowMs: 60 * 60 * 1000,
  },
  ai: {
    model: "meta-llama/llama-3.3-70b-instruct",
    validationTemperature: parseBoundedFloat(process.env.AI_VALIDATION_TEMPERATURE, 0, 0, 2),
    editPromptMinLength: 10,
    editPromptMaxLength: 1000,
    generationPromptMaxLength: 600,
    defaultGenerationTemperature: 0.7,
    defaultEditTemperature: 0.3,
    modelTemperatureMin: 0,
    modelTemperatureMax: 2,
  },
  html: {
    maxGeneratedHtmlChars: parsePositiveInt(process.env.AI_MAX_GENERATED_HTML_CHARS, 500_000),
  },
  file: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
    maxOriginalDocTextChars: 200_000,
    maxOriginalContextPromptChars: 25_000,
    maxOriginalContextLinks: 50,
  },
  security: {
    maxLinkTextLength: 300,
    maxLinkHrefLength: 2048,
    maxLinksCount: 200,
  },
};
