import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ctxFromExtra, assertWrite, toolJson, toolError, type McpServices } from '../mcp-server.factory';

export function registerWriteTools(server: McpServer, s: McpServices): void {
  server.registerTool(
    'move_candidate_stage',
    {
      title: 'Move candidate to a hiring stage',
      description: 'Move a candidate to a different hiring stage in their job pipeline.',
      inputSchema: {
        candidate_id: z.string().uuid().describe('Candidate UUID.'),
        hiring_stage_id: z.string().uuid().describe('Target hiring stage UUID (from the job).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        await s.candidates.updateStage(args.candidate_id, { hiring_stage_id: args.hiring_stage_id }, org);
        return toolJson({ ok: true, candidate_id: args.candidate_id, hiring_stage_id: args.hiring_stage_id });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to move candidate.');
      }
    },
  );

  server.registerTool(
    'reject_candidate',
    {
      title: 'Reject candidate',
      description: 'Reject a candidate with a reason and optional note.',
      inputSchema: {
        candidate_id: z.string().uuid().describe('Candidate UUID.'),
        reason: z.string().describe('Rejection reason (must match an allowed reason code).'),
        note: z.string().optional().describe('Optional free-text note.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        const res = await s.candidates.rejectCandidate(
          args.candidate_id,
          { reason: args.reason as never, note: args.note },
          org,
        );
        return toolJson(res);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to reject candidate.');
      }
    },
  );

  server.registerTool(
    'update_candidate',
    {
      title: 'Update candidate',
      description:
        'Update candidate fields (name, email, phone, role, location, experience, salary expectations, or job assignment). Only provided fields change.',
      inputSchema: {
        candidate_id: z.string().uuid().describe('Candidate UUID.'),
        full_name: z.string().optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        current_role: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        years_experience: z.number().int().min(0).max(50).nullable().optional(),
        job_id: z.string().uuid().nullable().optional().describe('Reassign to a job (rescoring runs automatically).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        const { candidate_id, ...patch } = args;
        return toolJson(await s.candidates.updateCandidate(candidate_id, patch as never, org));
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to update candidate.');
      }
    },
  );

  server.registerTool(
    'add_stage_summary',
    {
      title: 'Add stage summary',
      description: 'Save a recruiter summary note for a candidate at a specific hiring stage.',
      inputSchema: {
        candidate_id: z.string().uuid().describe('Candidate UUID.'),
        stage_id: z.string().uuid().describe('Hiring stage UUID.'),
        summary: z.string().min(1).describe('Summary text.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        return toolJson(await s.candidates.saveStageSummary(args.candidate_id, args.stage_id, args.summary, org));
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to save stage summary.');
      }
    },
  );

  server.registerTool(
    'create_job',
    {
      title: 'Create job',
      description:
        'Create a new job. `title` is required; other fields (department, location, description, must_have_skills, etc.) are optional.',
      inputSchema: {
        title: z.string().min(1).describe('Job title (required).'),
        department: z.string().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        must_have_skills: z.array(z.string()).optional(),
        nice_to_have_skills: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        return toolJson(await s.jobs.createJob(args as never, org));
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to create job.');
      }
    },
  );

  server.registerTool(
    'update_job',
    {
      title: 'Update job',
      description: 'Update an existing job by id. Same fields as create_job.',
      inputSchema: {
        job_id: z.string().uuid().describe('Job UUID.'),
        title: z.string().min(1).describe('Job title.'),
        department: z.string().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        must_have_skills: z.array(z.string()).optional(),
        nice_to_have_skills: z.array(z.string()).optional(),
        status: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        const { job_id, ...patch } = args;
        return toolJson(await s.jobs.updateJob(job_id, patch as never, org));
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to update job.');
      }
    },
  );
}
