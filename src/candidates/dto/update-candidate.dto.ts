import { z } from 'zod';

export const UpdateCandidateSchema = z.object({
  job_id: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID')
    .optional(),
  full_name: z.string().optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  current_role: z.string().optional(),
  location: z.string().optional(),
  years_experience: z.coerce.number().int().min(0).max(50).optional(),
});

export type UpdateCandidateDto = z.infer<typeof UpdateCandidateSchema>;
