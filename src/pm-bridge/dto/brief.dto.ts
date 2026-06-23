import { z } from 'zod';

export const PageSchema = z.object({
  name: z.string(),
  route: z.string(),
});
export type Page = z.infer<typeof PageSchema>;

// Hidden structured intent. Emitted by stage ① clarify, consumed by ②③.
export const InternalBriefSchema = z.object({
  goal: z.string(),                 // the one line shown to the PM
  problem: z.string(),
  desiredOutcomes: z.array(z.string()),
  constraints: z.array(z.string()),
  affectedArea: PageSchema,
  sizeHint: z.enum(['tiny', 'medium', 'large']),
  devNotes: z.array(z.string()),    // technical seeds for enrichment
  rawText: z.string(),
  conversationDigest: z.string(),
});
export type InternalBrief = z.infer<typeof InternalBriefSchema>;
