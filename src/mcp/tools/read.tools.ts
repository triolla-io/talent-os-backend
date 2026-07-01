import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ctxFromExtra, toolJson, toolError, type McpServices } from '../mcp-server.factory';

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function registerReadTools(server: McpServer, s: McpServices): void {
  server.registerTool(
    'search_candidates',
    {
      title: 'Search candidates',
      description:
        "Search candidates in the caller's organization. Optional keyword `q`, `filter`, `job_id`, and `unassigned`. Returns a list plus a total count. Does NOT return CV text — use get_candidate_cv for a CV link.",
      inputSchema: {
        q: z.string().optional().describe('Keyword across name/role/email.'),
        filter: z.string().optional().describe('Named filter (e.g. duplicates, unassigned).'),
        job_id: z.string().uuid().optional().describe('Restrict to one job (its pipeline).'),
        unassigned: z.boolean().optional().describe('Only candidates with no assigned job.'),
      },
      annotations: readOnly,
    },
    async (args, extra) => {
      const { org } = ctxFromExtra(extra);
      const res = await s.candidates.findAll(org, args.q, args.filter as never, args.job_id, args.unassigned);
      return toolJson(res);
    },
  );

  server.registerTool(
    'get_candidate',
    {
      title: 'Get candidate',
      description:
        "Fetch one candidate by id (scoped to the caller's organization). Returns the full candidate record (no CV text).",
      inputSchema: { candidate_id: z.string().uuid().describe('Candidate UUID.') },
      annotations: readOnly,
    },
    async (args, extra) => {
      const { org } = ctxFromExtra(extra);
      try {
        return toolJson(await s.candidates.findOne(args.candidate_id, org));
      } catch {
        return toolError(`Candidate ${args.candidate_id} not found. Use search_candidates to find valid ids.`);
      }
    },
  );

  server.registerTool(
    'get_candidate_cv',
    {
      title: 'Get candidate CV link',
      description:
        "Return a short-lived presigned URL to download the candidate's original CV file. Raw CV text is never returned.",
      inputSchema: { candidate_id: z.string().uuid().describe('Candidate UUID.') },
      annotations: { ...readOnly, openWorldHint: true },
    },
    async (args, extra) => {
      const { org } = ctxFromExtra(extra);
      try {
        return toolJson(await s.candidates.getCvPresignedUrl(args.candidate_id, org));
      } catch {
        return toolError(`No CV available for candidate ${args.candidate_id}.`);
      }
    },
  );

  server.registerTool(
    'list_jobs',
    {
      title: 'List jobs',
      description: 'List jobs in the organization. Optional `status` filter (e.g. active, draft). Returns jobs + total.',
      inputSchema: { status: z.string().optional().describe('Filter by status.') },
      annotations: readOnly,
    },
    async (args, extra) => {
      const { org } = ctxFromExtra(extra);
      return toolJson(await s.jobs.findAll(org, args.status));
    },
  );

  server.registerTool(
    'get_job',
    {
      title: 'Get job',
      description: 'Fetch one job by id (scoped to the organization).',
      inputSchema: { job_id: z.string().uuid().describe('Job UUID.') },
      annotations: readOnly,
    },
    async (args, extra) => {
      const { org } = ctxFromExtra(extra);
      try {
        return toolJson(await s.jobs.findOne(args.job_id, org));
      } catch {
        return toolError(`Job ${args.job_id} not found. Use list_jobs to find valid ids.`);
      }
    },
  );

  server.registerTool(
    'get_pipeline',
    {
      title: 'Get job pipeline',
      description: "Return the candidates in a job's hiring pipeline (Kanban by stage), filtered to one job.",
      inputSchema: { job_id: z.string().uuid().describe('Job UUID whose pipeline to return.') },
      annotations: readOnly,
    },
    async (args, extra) => {
      const { org } = ctxFromExtra(extra);
      return toolJson(await s.candidates.findAll(org, undefined, undefined, args.job_id, undefined));
    },
  );

  server.registerTool(
    'dashboard_counts',
    {
      title: 'Dashboard counts',
      description: 'Return summary counts for the organization: total, duplicates, unassigned.',
      inputSchema: {},
      annotations: readOnly,
    },
    async (_args, extra) => {
      const { org } = ctxFromExtra(extra);
      return toolJson(await s.candidates.getCounts(org));
    },
  );
}
