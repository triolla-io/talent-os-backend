import { z } from 'zod';
import { PageSchema } from './brief.dto';

// Re-exported so consumers can import Page alongside the converse types from one place.
export type { Page } from './brief.dto';

export const TurnSchema = z.object({
  role: z.enum(['pm', 'assistant']),
  content: z.string(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ConverseRequestSchema = z.object({
  messages: z.array(TurnSchema).min(1),
  page: PageSchema,
});
export type ConverseRequest = z.infer<typeof ConverseRequestSchema>;

export const ClarifyQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  chips: z.array(z.string()),       // tappable answers; [] when free-text only
  allowFreeText: z.boolean(),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

// HTTP responses — PM-facing, no Jira concepts.
export type ConverseResponse =
  | { type: 'clarify'; questions: ClarifyQuestion[] }
  | { type: 'ready'; goal: string; brief: import('./brief.dto').InternalBrief }
  | { type: 'held' };
