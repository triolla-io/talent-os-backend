import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

export const CandidateExtractSchema = z.object({
  fullName: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  currentRole: z.string().nullable(),
  yearsExperience: z.number().int().nullable(),
  skills: z.array(z.string()),
  summary: z.string().nullable(),
  source: z.enum(['direct', 'agency', 'linkedin', 'referral', 'website']).default('direct'),
});

export type CandidateExtract = z.infer<typeof CandidateExtractSchema> & {
  suspicious: boolean;
};

const FALLBACK: Omit<CandidateExtract, 'suspicious'> = {
  fullName: '',
  email: null,
  phone: null,
  currentRole: null,
  yearsExperience: null,
  skills: [],
  summary: null,
  source: 'direct',
};

const SYSTEM_PROMPT = `You are a CV data extraction assistant.
Extract structured candidate information from the provided email and CV text.
Source detection rules:
- 'agency': email includes recruiter name + agency name + "on behalf of"
- 'linkedin': subject contains "LinkedIn"
- 'referral': body mentions "referred by"
- Default to 'direct'
Summary (ai_summary): exactly 2 sentences — sentence 1 is role/experience level,
sentence 2 highlights top skills or notable achievement.
Ambiguous content: still attempt extraction; do not throw.
If a field cannot be determined, use null.`;

@Injectable()
export class ExtractionAgentService {
  private readonly logger = new Logger(ExtractionAgentService.name);

  constructor(private readonly config: ConfigService) {}

  async extract(fullText: string, suspicious: boolean): Promise<CandidateExtract> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY')!;

    const openrouter = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });

    try {
      const { object } = await generateObject({
        model: openrouter('google/gemma-3-12b-it:free'),
        schema: CandidateExtractSchema,
        system: SYSTEM_PROMPT,
        prompt: `Extract candidate information from the following text:\n\n${fullText}`,
      });
      return { ...object, suspicious };
    } catch (err) {
      this.logger.error(
        `OpenRouter extraction failed — returning fallback. Reason: ${(err as Error).message}`,
      );
      return { ...FALLBACK, suspicious };
    }
  }
}
