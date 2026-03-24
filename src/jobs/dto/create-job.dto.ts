import { z } from 'zod';

export const HiringStageCreateSchema = z.object({
  name: z.string().min(1, 'Stage name required').max(255),
  order: z.number().int().min(1).max(100),
  responsibleUserId: z.string().nullable().optional(), // D-09: free text
  isCustom: z.boolean().default(false),
});
export type HiringStageCreateInput = z.infer<typeof HiringStageCreateSchema>;

export const ScreeningQuestionCreateSchema = z.object({
  text: z.string().min(1, 'Question text required'),
  answerType: z.enum(['yes_no', 'text', 'multiple_choice', 'file_upload']),
  required: z.boolean().default(false),
  knockout: z.boolean().default(false),
  order: z.number().int().min(1).optional(),
});
export type ScreeningQuestionCreateInput = z.infer<typeof ScreeningQuestionCreateSchema>;

export const CreateJobSchema = z.object({
  // Required
  title: z.string().min(1, 'Job title required').max(255),
  // Existing Job fields (kept per D-01)
  description: z.string().optional(),
  requirements: z.array(z.string()).default([]),
  department: z.string().optional(),
  location: z.string().optional(),
  jobType: z.string().default('full_time'),
  status: z.string().default('draft'),
  salaryRange: z.string().optional(),
  hiringManager: z.string().optional(),
  // New Phase 10 fields
  roleSummary: z.string().optional(),
  responsibilities: z.string().optional(),
  whatWeOffer: z.string().optional(),
  mustHaveSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  expYearsMin: z.number().int().min(0).optional(),
  expYearsMax: z.number().int().min(0).optional(),
  preferredOrgTypes: z.array(z.string()).default([]),
  // Nested arrays (optional per D-07)
  hiringStages: z.array(HiringStageCreateSchema).optional(),
  screeningQuestions: z.array(ScreeningQuestionCreateSchema).optional(),
});
export type CreateJobDto = z.infer<typeof CreateJobSchema>;
