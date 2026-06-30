import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouter } from '@openrouter/sdk';

export interface CandidateSummaryParams {
  fullName: string;
  currentRole?: string | null;
  yearsExperience?: number | null;
  skills: string[];
  cvText?: string | null;
  jobTitle?: string | null;
}

// Strips ONE leading bullet marker the model may emit: a glyph (•, -, –, *) or
// numbering (`N.` / `N)`), with any trailing space. The frontend's renderer only
// strips glyphs, not numbering — so we MUST strip numbering here to keep stored
// content clean.
const LEADING_MARKER = /^\s*(?:[•\-–*]|\d+[.)])\s*/;

/**
 * Normalizes raw LLM output into newline-separated bullet lines:
 * split on newlines, trim each line, strip a stray leading glyph/number,
 * drop blank lines, cap at 5 lines, re-join with `\n`.
 * Returns '' for empty / whitespace-only input.
 */
export function formatSummaryBullets(raw: string): string {
  if (!raw) return '';
  return raw
    .split('\n')
    .map((line) => line.trim().replace(LEADING_MARKER, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .join('\n');
}

@Injectable()
export class CandidateAiService {
  private readonly logger = new Logger(CandidateAiService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Generates 3–5 concise bullet lines summarizing the candidate using
   * OpenRouter (gpt-4o-mini), normalized to newline-separated lines with no
   * leading glyph. Returns `null` if the API call fails or output is empty.
   */
  async generateSummary(params: CandidateSummaryParams): Promise<string | null> {
    try {
      const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
      if (!apiKey) {
        this.logger.warn('OPENROUTER_API_KEY is missing. Skipping AI summary extraction.');
        return null;
      }

      const client = new OpenRouter({ apiKey });

      const instructions = `You are an HR assistant. Summarize the candidate as 3 to 5 concise bullet points.
Rules:
- One short fact per line, separated by newlines. Each line at most ~12 words.
- Do NOT add bullet characters, dashes, or numbering — output the plain fact text only.
- Prioritize, in order: current role + seniority/years; standout skills; a notable achievement or domain.

Return ONLY the raw lines (no quotes, no JSON, no markdown).`;

      // Build context payload
      const contextLines = [
        `Candidate Name: ${params.fullName}`,
        params.currentRole ? `Current Role: ${params.currentRole}` : '',
        params.yearsExperience ? `Years of Experience: ${params.yearsExperience}` : '',
        params.skills.length > 0 ? `Skills: ${params.skills.join(', ')}` : '',
        params.jobTitle ? `Applying for Job Title: ${params.jobTitle}` : '',
      ].filter(Boolean);

      let userMessage = `-- Candidate Details --\n${contextLines.join('\n')}`;

      if (params.cvText) {
        // To avoid exceeding token limits, slice the CV if it's excessively large
        // (gpt-4o-mini handles 128k context, but let's be safe and limit string length to ~25k chars)
        const truncatedCv = params.cvText.slice(0, 25000);
        userMessage += `\n\n-- CV Content --\n${truncatedCv}`;
      }

      const result = client.callModel({
        model: 'openai/gpt-4o-mini',
        instructions,
        input: userMessage,
      });

      const raw = await result.getText();
      const summary = formatSummaryBullets(raw);

      if (!summary) {
        this.logger.warn(`AI summary for candidate ${params.fullName} was empty after formatting`);
        return null;
      }

      this.logger.log(`Successfully generated AI summary for candidate ${params.fullName}`);
      return summary;

    } catch (err) {
      // Graceful degradation: log and return null
      this.logger.warn(`Failed to generate candidate AI summary: ${err.message}`);
      return null;
    }
  }
}
