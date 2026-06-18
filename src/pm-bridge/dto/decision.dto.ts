import { z } from 'zod';

export const CreateDecisionSchema = z.object({
  statement: z.string().min(1),
  contextRoute: z.string().optional(),
});

export const UpdateDecisionSchema = z.object({
  status: z.enum(['superseded']).optional(),
  supersededBy: z.uuid().optional(),
  statement: z.string().min(1).optional(),
});

export type CreateDecision = z.infer<typeof CreateDecisionSchema>;
export type UpdateDecision = z.infer<typeof UpdateDecisionSchema>;
