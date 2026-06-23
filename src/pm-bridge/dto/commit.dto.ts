import { z } from 'zod';
import { InternalBriefSchema, PageSchema } from './brief.dto';

export const CommitRequestSchema = z.object({
  brief: InternalBriefSchema,
  page: PageSchema,
});
export type CommitRequest = z.infer<typeof CommitRequestSchema>;

export type CommitResponse = { type: 'filed' | 'merged' | 'held' };
