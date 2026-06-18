import { z } from 'zod';

const DraftSchema = z.object({
  issueType: z.enum(['Epic', 'Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  suggestedEpicKey: z.string().optional(),
});

const VerdictSchema = z.object({
  status: z.enum(['clean', 'duplicate', 'conflict_ticket', 'conflict_decision']),
  relatedTickets: z.array(
    z.object({
      key: z.string(),
      summary: z.string(),
      relation: z.enum(['duplicate', 'conflicts', 'related']),
      explanationPlain: z.string(),
    }),
  ),
  conflictingDecisions: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      explanationPlain: z.string(),
    }),
  ),
  recommendedAction: z.enum(['create', 'update', 'review']),
  recommendedTargetKey: z.string().optional(),
});

export const DraftVerdictSchema = z.object({ draft: DraftSchema, verdict: VerdictSchema });
export type DraftVerdict = z.infer<typeof DraftVerdictSchema>;
export type IssueDraft = z.infer<typeof DraftSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
