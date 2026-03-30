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

@Injectable()
export class CandidateAiService {
  private readonly logger = new Logger(CandidateAiService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Generates a 2-sentence summary of the candidate using OpenRouter (gpt-4o-mini).
   * Falls back gracefully and returns `null` if the API call fails or encounters an error.
   */
  async generateSummary(params: CandidateSummaryParams): Promise<string | null> {
    try {
      const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
      if (!apiKey) {
        this.logger.warn('OPENROUTER_API_KEY is missing. Skipping AI summary extraction.');
        return null;
      }

      const client = new OpenRouter({ apiKey });

      const instructions = `You are an HR assistant. Write exactly 2 sentences summarizing the candidate.
Sentence 1 must detail their current role, experience level, and years of experience.
Sentence 2 must highlight their top skills or a notable achievement.

Return ONLY the raw string summary (no quotes, no JSON, no markdown).`;

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
      const cleanSummary = raw.trim().replace(/^"|"$/g, '');
      
      this.logger.log(`Successfully generated AI summary for candidate ${params.fullName}`);
      return cleanSummary;

    } catch (err) {
      // Graceful degradation: log and return null
      this.logger.warn(`Failed to generate candidate AI summary: ${err.message}`);
      return null;
    }
  }
}
