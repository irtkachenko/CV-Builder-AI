import OpenAI from 'openai';
import { createLogger } from "./logger-service";
import { appConfig } from "../config/app-config";
import { replacePromptPlaceholders } from "../utils/prompt-utils";

const logger = createLogger('HALLUCINATION_FILTER');

// OpenRouter client
const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

export interface HallucinationResult {
  isHallucinated: boolean;
  confidence: number;
  issues: HallucinationIssue[];
  filteredHtml?: string;
}

export interface HallucinationIssue {
  type: 'invented_experience' | 'impossible_dates' | 'fake_skills' | 'contradictory_info' | 'suspicious_patterns';
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence?: string;
  suggestion?: string;
}

export interface ConsistencyCheck {
  isConsistent: boolean;
  confidence: number;
  issues: ConsistencyIssue[];
}

export interface ConsistencyIssue {
  type: 'date_conflict' | 'skill_experience_mismatch' | 'education_timeline_issue' | 'contact_inconsistency';
  severity: 'low' | 'medium' | 'high';
  description: string;
  details?: string;
}

/**
 * Detects hallucinations and fake information in generated CV content
 */
export async function detectHallucinations(
  originalText: string,
  generatedHtml: string
): Promise<HallucinationResult> {
  try {
    const prompt = replacePromptPlaceholders(appConfig.prompts.hallucinationDetection.userPrompt, {
      originalText,
      generatedHtml
    });

    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        {
          role: "system",
          content: appConfig.prompts.hallucinationDetection.systemPrompt,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.1, // Low temperature for consistent analysis
    });

    const content = response.choices[0]?.message?.content || '';
    
    // Extract JSON from response
    const startIndex = content.indexOf('{');
    const endIndex = content.lastIndexOf('}');
    
    if (startIndex === -1 || endIndex === -1) {
      logger.error('No JSON found in hallucination detection response');
      return createFallbackResult();
    }

    const jsonStr = content.substring(startIndex, endIndex + 1);
    const result = JSON.parse(jsonStr) as HallucinationResult;

    // Validate result structure
    if (typeof result.isHallucinated !== 'boolean' || typeof result.confidence !== 'number') {
      logger.error('Invalid hallucination detection result structure');
      return createFallbackResult();
    }

    logger.info('Hallucination detection completed', {
      isHallucinated: result.isHallucinated,
      confidence: result.confidence,
      issuesCount: result.issues?.length || 0
    });

    return result;
  } catch (error) {
    logger.error('Hallucination detection failed', { error: error instanceof Error ? error.message : String(error) });
    return createFallbackResult();
  }
}

/**
 * Checks logical consistency of CV data
 */
export async function checkLogicalConsistency(
  generatedHtml: string
): Promise<ConsistencyCheck> {
  try {
    const prompt = replacePromptPlaceholders(appConfig.prompts.consistencyCheck.userPrompt, {
      generatedHtml
    });

    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [
        {
          role: "system",
          content: appConfig.prompts.consistencyCheck.systemPrompt,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // Extract JSON from response
    const startIndex = content.indexOf('{');
    const endIndex = content.lastIndexOf('}');
    
    if (startIndex === -1 || endIndex === -1) {
      logger.error('No JSON found in consistency check response');
      return createFallbackConsistencyResult();
    }

    const jsonStr = content.substring(startIndex, endIndex + 1);
    const result = JSON.parse(jsonStr) as ConsistencyCheck;

    // Validate result structure
    if (typeof result.isConsistent !== 'boolean' || typeof result.confidence !== 'number') {
      logger.error('Invalid consistency check result structure');
      return createFallbackConsistencyResult();
    }

    logger.info('Consistency check completed', {
      isConsistent: result.isConsistent,
      confidence: result.confidence,
      issuesCount: result.issues?.length || 0
    });

    return result;
  } catch (error) {
    logger.error('Consistency check failed', { error: error instanceof Error ? error.message : String(error) });
    return createFallbackConsistencyResult();
  }
}

/**
 * Filters out suspicious content from generated HTML
 */
export function filterSuspiciousContent(html: string, issues: HallucinationIssue[]): string {
  let filteredHtml = html;

  for (const issue of issues) {
    if (issue.severity === 'high' && issue.evidence) {
      // Remove or flag highly suspicious content
      const suspiciousPattern = new RegExp(issue.evidence, 'gi');
      filteredHtml = filteredHtml.replace(suspiciousPattern, '[FILTERED CONTENT]');
    }
  }

  return filteredHtml;
}

/**
 * Determines if content should be rejected based on hallucination analysis
 */
export function shouldRejectContent(result: HallucinationResult): boolean {
  // Reject if high confidence hallucination detected
  if (result.isHallucinated && result.confidence > 0.8) {
    return true;
  }

  // Reject if multiple high-severity issues
  const highSeverityIssues = result.issues?.filter(issue => issue.severity === 'high') || [];
  if (highSeverityIssues.length >= 2) {
    return true;
  }

  // Reject if invented experience detected with high confidence
  const inventedExperience = result.issues?.filter(
    issue => issue.type === 'invented_experience' && issue.severity === 'high'
  ) || [];
  if (inventedExperience.length > 0) {
    return true;
  }

  return false;
}

/**
 * Generates user-friendly message for hallucination detection results
 */
export function generateHallucinationMessage(result: HallucinationResult): string {
  if (!result.isHallucinated) {
    return '✅ Content verification passed - no significant issues detected.';
  }

  const highSeverityIssues = result.issues?.filter(issue => issue.severity === 'high') || [];
  const mediumSeverityIssues = result.issues?.filter(issue => issue.severity === 'medium') || [];

  if (highSeverityIssues.length > 0) {
    return '❌ Content contains potentially fabricated information. Please review your original document and try again.';
  }

  if (mediumSeverityIssues.length > 0) {
    return '⚠️ Content has some inconsistencies. Please verify the accuracy of the information.';
  }

  return '⚠️ Minor content issues detected. Please review the generated CV for accuracy.';
}

function createFallbackResult(): HallucinationResult {
  return {
    isHallucinated: false,
    confidence: 0.5,
    issues: [],
  };
}

function createFallbackConsistencyResult(): ConsistencyCheck {
  return {
    isConsistent: true,
    confidence: 0.5,
    issues: [],
  };
}
