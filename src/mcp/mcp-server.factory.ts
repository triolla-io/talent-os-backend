import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CandidatesService } from '../candidates/candidates.service';
import type { JobsService } from '../jobs/jobs.service';
import type { CandidateAiService } from '../candidates/candidate-ai.service';
import { registerReadTools } from './tools/read.tools';
import { registerWriteTools } from './tools/write.tools';
import { registerAiTools } from './tools/ai.tools';

export interface McpToolCtx {
  org: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}
export interface McpServices {
  candidates: CandidatesService;
  jobs: JobsService;
  candidateAi: CandidateAiService;
}

export function ctxFromExtra(extra: { authInfo?: { extra?: Record<string, unknown> } }): McpToolCtx {
  const e = extra?.authInfo?.extra ?? {};
  return { org: String(e.org), role: e.role as McpToolCtx['role'] };
}

export function assertWrite(role: string): void {
  if (role === 'viewer') {
    throw new Error('This action requires a member, admin, or owner role. Viewers have read-only access.');
  }
}

export function toolError(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}

// NestJS HttpExceptions built from an object (our services throw
// `new BadRequestException({ error: { code, message } })`) stringify to just the class
// name ("Bad Request Exception"), which tells the model nothing. Dig out the real message.
export function errorMessage(e: unknown, fallback: string): string {
  if (
    e &&
    typeof e === 'object' &&
    'getResponse' in e &&
    typeof (e as { getResponse: unknown }).getResponse === 'function'
  ) {
    const r = (e as { getResponse(): unknown }).getResponse();
    if (typeof r === 'string') return r;
    const body = r as { error?: { message?: unknown }; message?: unknown };
    const nested = body?.error?.message ?? body?.message;
    if (typeof nested === 'string') return nested;
    if (Array.isArray(nested)) return nested.join('; ');
  }
  return e instanceof Error && e.message ? e.message : fallback;
}
export function toolJson(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export function buildMcpServer(services: McpServices): McpServer {
  const server = new McpServer({ name: 'talent-os-mcp', version: '1.0.0' });
  registerReadTools(server, services);
  registerWriteTools(server, services);
  registerAiTools(server, services);
  return server;
}
