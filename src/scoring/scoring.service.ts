import { Injectable } from '@nestjs/common';
import { z } from 'zod';

export const ScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
});
export type ScoreResult = z.infer<typeof ScoreSchema>;

export interface ScoringInput {
  cvText: string;
  candidateFields: {
    currentRole: string | null;
    yearsExperience: number | null;
    skills: string[];
  };
  job: {
    title: string;
    description: string | null;
    requirements: string[];
  };
}

// Scoring prompt for real Anthropic call (D-07)
// const SCORING_SYSTEM_PROMPT = `You are a technical recruiter evaluating candidate fit.
// Score the candidate 0-100 against the job requirements.
// Return: score (integer 0-100), reasoning (1-2 sentences), strengths (array of strings), gaps (array of strings).
// Be concise and specific. Base score solely on the provided information.`;

@Injectable()
export class ScoringAgentService {
  async score(input: ScoringInput): Promise<ScoreResult & { modelUsed: string }> {
    // TODO: replace mock with real Anthropic call (D-09)
    // const { object } = await generateObject({
    //   model: anthropic('claude-sonnet-4-6'),
    //   schema: ScoreSchema,
    //   system: SCORING_SYSTEM_PROMPT,
    //   prompt: `CV:\n${input.cvText}\n\nJob: ${input.job.title}\nDescription: ${input.job.description ?? 'N/A'}\nRequirements: ${input.job.requirements.join(', ')}`,
    // });
    // return { ...object, modelUsed: 'claude-sonnet-4-6' };

    void input; // used by real implementation
    return {
      score: 72,
      reasoning: 'Strong TypeScript background matches the role requirements.',
      strengths: ['TypeScript', 'Node.js'],
      gaps: ['No PostgreSQL mentioned'],
      modelUsed: 'claude-sonnet-4-6',
    };
  }
}
