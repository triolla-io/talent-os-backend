import { z } from 'zod';

export const StageSummarySchema = z.object({
  summary: z.string().min(1, 'Summary cannot be empty'),
});

export type StageSummaryDto = z.infer<typeof StageSummarySchema>;
