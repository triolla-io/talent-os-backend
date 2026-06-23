import { z } from 'zod';
import { InternalBriefSchema } from './brief.dto';
import { ClarifyQuestionSchema } from './converse.dto';

// ── Stage ① clarify ──────────────────────────────────────────────────────────
// The model returns EITHER clarify questions OR a ready brief + one-line goal.
export const ClarifyResultSchema = z.object({
  type: z.enum(['clarify', 'ready']),
  questions: z.array(ClarifyQuestionSchema),   // [] when ready
  goal: z.string(),                            // '' when clarifying
  brief: InternalBriefSchema.nullable(),       // null when clarifying
});
export type ClarifyResult = z.infer<typeof ClarifyResultSchema>;

// ── Stage ② validate ─────────────────────────────────────────────────────────
export const ValidationResultSchema = z.object({
  status: z.enum(['clean', 'duplicate', 'conflict']),
  duplicateOfKey: z.string().nullable(),       // set only when status='duplicate'
  reasonPlain: z.string(),                     // plain-English why (for Daniel / the hold)
  related: z.array(
    z.object({ key: z.string(), summary: z.string(), reasonPlain: z.string() }),
  ),
  conflictingDecisionIds: z.array(z.string()),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ── Stage ③ decompose ────────────────────────────────────────────────────────
// Native Jira 3-level hierarchy: Epic ▸ Story/Task/Bug ▸ Sub-task.
export const DecomposedSubtaskSchema = z.object({
  summary: z.string(),
  description: z.string(),
});
export type DecomposedSubtask = z.infer<typeof DecomposedSubtaskSchema>;

export const DecomposedChildSchema = z.object({
  issueType: z.enum(['Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  subtasks: z.array(DecomposedSubtaskSchema),
});
export type DecomposedChild = z.infer<typeof DecomposedChildSchema>;

export const DecomposedRootSchema = z.object({
  issueType: z.enum(['Epic', 'Story', 'Task', 'Bug']),
  summary: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  children: z.array(DecomposedChildSchema),    // populated when root is an Epic
  subtasks: z.array(DecomposedSubtaskSchema),  // populated when root is a Story/Task
});
export type DecomposedRoot = z.infer<typeof DecomposedRootSchema>;

export const DecomposeResultSchema = z.object({
  size: z.enum(['tiny', 'medium', 'large']),
  root: DecomposedRootSchema,
});
export type DecomposeResult = z.infer<typeof DecomposeResultSchema>;
