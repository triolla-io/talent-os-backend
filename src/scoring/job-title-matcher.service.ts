import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouter } from '@openrouter/sdk';
import { z } from 'zod';

export interface JobTitleMatchResult {
  matched: boolean;
  confidence: number; // 0-1 decimal
  reasoning?: string;
  error?: string;
}

const JobTitleMatchSchema = z.object({
  matched: z.boolean(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
});

const INSTRUCTIONS = `You are a job title matching assistant for a tech recruiting platform.
Given two job titles, determine if they refer to the same role, considering seniority levels, specializations, and common variations.

Return ONLY a raw JSON object — no markdown, no code fences, no explanation.
The JSON must contain exactly these keys:
- matched: boolean indicating whether the two titles refer to the same role
- confidence: number 0-100 where:
  - 90-100: Clearly the same role (e.g., "Software Engineer" vs "Senior Software Engineer")
  - 70-89: Likely the same role with different wording (e.g., "Frontend Dev" vs "Web Engineer")
  - 50-69: Could be same role but with significant variations (rare for clear matches)
  - 0-49: Different roles or specializations
- reasoning: brief explanation of the match decision

Example output:
{
  "matched": true,
  "confidence": 92,
  "reasoning": "Both refer to software engineer roles; seniority differs but core skill set is the same"
}`;

@Injectable()
export class JobTitleMatcherService {
  private readonly logger = new Logger(JobTitleMatcherService.name);

  constructor(private readonly config: ConfigService) {}

  async matchJobTitles(
    candidateJobTitle: string,
    positionJobTitle: string,
    tenantId: string
  ): Promise<JobTitleMatchResult> {
    try {
      // Handle empty inputs
      if (!candidateJobTitle?.trim() || !positionJobTitle?.trim()) {
        return {
          matched: false,
          confidence: 0,
        };
      }

      const result = await this.callAI(
        candidateJobTitle,
        positionJobTitle,
        tenantId
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Job title matching failed: ${errorMessage}`,
        {
          candidateJobTitle,
          positionJobTitle,
          tenantId,
        }
      );

      return {
        matched: false,
        confidence: 0,
        error: errorMessage,
      };
    }
  }

  private async callAI(
    candidateJobTitle: string,
    positionJobTitle: string,
    tenantId: string
  ): Promise<JobTitleMatchResult> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY')!;
    const client = new OpenRouter({ apiKey });

    const userMessage = [
      `Candidate's Job Title: "${candidateJobTitle}"`,
      `Position's Job Title: "${positionJobTitle}"`,
      `Tenant ID: ${tenantId}`,
    ].join('\n');

    const result = client.callModel({
      model: 'openai/gpt-4o-mini',
      instructions: INSTRUCTIONS,
      input: userMessage,
    });

    const raw = await result.getText();

    // Strip markdown code fences if the model ignores instructions
    const json = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parseResult = JobTitleMatchSchema.safeParse(JSON.parse(json));
    if (!parseResult.success) {
      this.logger.error('LLM returned invalid JSON structure', parseResult.error.issues);
      throw new Error(`LLM output validation failed: ${parseResult.error.message}`);
    }

    // Convert confidence from 0-100 to 0-1 decimal
    const confidenceDecimal = parseResult.data.confidence / 100;

    return {
      matched: parseResult.data.matched,
      confidence: Math.min(Math.max(confidenceDecimal, 0), 1), // Clamp to 0-1
      reasoning: parseResult.data.reasoning,
    };
  }
}
