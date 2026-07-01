import { z } from 'zod';

export const UpdateCandidateSchema = z.object({
  job_id: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID')
    .optional(),
  full_name: z.string().optional(),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.email().optional()),
  phone: z.string().optional(),
  current_role: z.string().optional(),
  location: z.string().optional(),
  years_experience: z.coerce.number().int().min(0).max(50).optional(),
  salary_expectation_min: z.coerce.number().int().min(0).nullable().optional(),
  salary_expectation_max: z.coerce.number().int().min(0).nullable().optional(),
  ai_score: z.coerce.number().int().min(0).max(100).optional(),
}).refine(
  (val) =>
    !(
      val.salary_expectation_min != null &&
      val.salary_expectation_max != null &&
      val.salary_expectation_min > val.salary_expectation_max
    ),
  {
    message: 'Minimum salary must be less than or equal to maximum salary',
    path: ['salary_expectation_max'],
  },
);

export type UpdateCandidateDto = z.infer<typeof UpdateCandidateSchema>;
