import { z } from 'zod';

const IssueSchema = z.object({
  issueType: z.enum(['Epic', 'Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  suggestedEpicKey: z.string().optional(),
});

export const CommitRequestSchema = z.object({
  action: z.enum(['create', 'update']),
  issue: IssueSchema,
  targetKey: z.string().regex(/^[A-Z]+-\d+$/).optional(),
  overrideReason: z.string().optional(),
  supersedesDecisionId: z.string().uuid().optional(),
});

export type CommitRequest = z.infer<typeof CommitRequestSchema>;
