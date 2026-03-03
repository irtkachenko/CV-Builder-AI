import OpenAI from 'openai';
import { appConfig } from "../config/app-config";

// Configure OpenRouter client
const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

export interface ValidationResult {
  isValid: boolean;
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  message: string;
  suggestions?: string[];
  confidence: number;
  issues?: ValidationIssue[];
}

export interface ValidationIssue {
  type: 'missing_info' | 'inappropriate_content' | 'format_issue' | 'quality_issue';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion?: string;
}

export async function validateCVContent(cvText: string): Promise<ValidationResult> {
  try {
    const textSnippet = cvText.trim();

    if (textSnippet.length < 50) {
      const shortMsg = 'CV text is too short. Please add more professional information.';

      return {
        isValid: false,
        quality: 'poor',
        confidence: 1,
        message: shortMsg,
        issues: [{
          type: 'quality_issue',
          severity: 'high',
          description: 'Document content is too sparse',
          suggestion: 'Provide more details about your experience and skills'
        }]
      };
    }

    const languageName = 'English';
    const prompt = `You are a professional CV analyzer. Your goal is to determine if the provided text looks like a CV or contains information that can be used to generate a CV.

CV TEXT TO ANALYZE:
"""
${cvText}
"""

VALIDATION RULES:
1. "isValid" should be TRUE only if the text contains actual, meaningful professional information with real values: real names, real contact details, actual skills listed, real work experience entries, or real education records.
2. "isValid" should be FALSE if the text:
   - Has correct CV structure/fields/sections but all or most fields are empty, placeholder, or blank (e.g., "Name: ", "Skills: ", "Experience: " with no actual data)
   - Contains only section headers or labels without any real content
   - Is completely random chars (gibberish)
   - Is extremely offensive or inappropriate
   - Is a completely different type of document (e.g., cooking recipe, fictional story, technical manual) with NO personal info
3. Be strict about content presence: structure alone does not make a CV valid — there must be actual data filled in.
4. If it looks like a rough draft of a CV with at least some real information filled in, it IS valid.

RESPONSE FORMAT (Return ONLY a raw JSON object):
{
  "isValid": boolean,
  "quality": "excellent" | "good" | "fair" | "poor",
  "confidence": number,
  "message": "Simple explanation in English",
  "suggestions": ["suggestion in English"],
  "issues": [
    {
      "type": "missing_info" | "quality_issue" | "inappropriate_content",
      "severity": "low" | "medium" | "high",
      "description": "Short description in English",
      "suggestion": "How to fix in English"
    }
  ]
}

Respond with JSON only.`;

    const response = await openrouter.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
      temperature: appConfig.ai.validationTemperature,
    });

    const content = response.choices[0]?.message?.content || '';

    // Improved JSON extraction: find the first '{' and last '}'
    const startIndex = content.indexOf('{');
    const endIndex = content.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1) {
      throw new Error(`No JSON object found in response: ${content.substring(0, 100)}...`);
    }

    const jsonStr = content.substring(startIndex, endIndex + 1);

    try {
      const result = JSON.parse(jsonStr) as ValidationResult;

      // Basic structure validation
      if (typeof result.isValid !== 'boolean') {
        throw new Error('Missing "isValid" field in response');
      }

      return result;
    } catch (parseError) {
      console.error('[VALIDATION] JSON Parse Error:', parseError);
      console.error('[VALIDATION] Culprit string:', jsonStr);
      throw parseError;
    }
  } catch (error) {
    console.error('[VALIDATION] System Error:', error);

    const fallbackMsg = 'Upload successful. Starting processing.';

    const fallbackSuggestion = 'Validation system is temporarily unavailable, but we will try to create your CV.';

    return {
      isValid: true,
      quality: 'fair',
      confidence: 0.5,
      message: fallbackMsg,
      suggestions: [fallbackSuggestion],
      issues: []
    };
  }
}

export function generateUserFriendlyMessage(result: ValidationResult): string {
  if (result.isValid) {
    switch (result.quality) {
      case 'excellent':
        return '🎉 Perfect! Your data is great, creating a professional CV of the highest quality!';
      case 'good':
        return '✅ Very good! I have all the necessary information to create a high-quality CV.';
      case 'fair':
        return '👍 Not bad! I\'ll create the CV, but next time you could add more details.';
      default:
        return result.message;
    }
  } else {
    const errorPrefix = '❌ Unfortunately, the data is not suitable. ';
    const warningPrefix = '⚠️ Data needs improvement. ';

    switch (result.quality) {
      case 'poor':
        return errorPrefix + result.message;
      case 'fair':
        return warningPrefix + result.message;
      default:
        return '❌ ' + result.message;
    }
  }
}

export function formatSuggestionsForUser(suggestions: string[]): string {
  if (!suggestions || suggestions.length === 0) {
    return '';
  }

  const label = 'Suggestions';
  return `\n\n💡 ${label}:\n` + suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
}
