import { z } from 'zod';

export const UpdateCandidateStageSchema = z.object({
  hiring_stage_id: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'hiring_stage_id must be a valid UUID'),
});

export type UpdateCandidateStageDto = z.infer<typeof UpdateCandidateStageSchema>;
