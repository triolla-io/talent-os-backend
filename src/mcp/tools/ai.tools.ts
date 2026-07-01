import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ctxFromExtra, assertWrite, toolJson, toolError, type McpServices } from '../mcp-server.factory';

export function registerAiTools(server: McpServer, s: McpServices): void {
  server.registerTool(
    'rescore_candidate',
    {
      title: 'Re-score candidate (AI)',
      description:
        'Re-run AI scoring for a candidate against their currently-assigned job and return the fresh score, reasoning, strengths, and gaps. Runs inline (one candidate × one job). Reports if the candidate has no assigned job or no CV text.',
      inputSchema: { candidate_id: z.string().uuid().describe('Candidate UUID.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        const result = await s.candidates.rescoreCandidate(args.candidate_id, org);
        if (!result) {
          return toolJson({ rescored: false, reason: 'Candidate has no assigned job or no CV text.' });
        }
        return toolJson({ rescored: true, ...result });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to rescore candidate.');
      }
    },
  );

  server.registerTool(
    'summarize_candidate',
    {
      title: 'Summarize candidate (AI)',
      description:
        'Generate an AI summary of a candidate (optionally in the context of their assigned job) and return the summary text. Runs inline.',
      inputSchema: { candidate_id: z.string().uuid().describe('Candidate UUID.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args, extra) => {
      const { org, role } = ctxFromExtra(extra);
      try {
        assertWrite(role);
        const c = await s.candidates.findOne(args.candidate_id, org);
        const summary = await s.candidateAi.generateSummary({
          fullName: (c as any).full_name ?? (c as any).fullName ?? '',
          currentRole: (c as any).current_role ?? null,
          yearsExperience: (c as any).years_experience ?? null,
          skills: (c as any).skills ?? [],
          jobTitle: (c as any).job_title ?? null,
        });
        if (!summary) return toolError('Summary generation is unavailable (missing API key or generation failed).');
        return toolJson({ candidate_id: args.candidate_id, summary });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : 'Failed to summarize candidate.');
      }
    },
  );
}
