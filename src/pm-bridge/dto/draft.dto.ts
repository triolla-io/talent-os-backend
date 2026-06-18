import { z } from 'zod';

export const DraftRequestSchema = z.object({
  text: z.string().min(1),
  mode: z.literal('ticket'),
});

export type DraftRequest = z.infer<typeof DraftRequestSchema>;
