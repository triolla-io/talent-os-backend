import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReadTools } from './read.tools';
import { ctxFromExtra, assertWrite } from '../mcp-server.factory';

describe('read tools + gate helpers', () => {
  it('ctxFromExtra extracts org + role from authInfo', () => {
    const ctx = ctxFromExtra({ authInfo: { extra: { org: 'o1', role: 'viewer', userId: 'u1' } } });
    expect(ctx).toEqual({ org: 'o1', role: 'viewer' });
  });

  it('assertWrite throws for viewer, allows member+', () => {
    expect(() => assertWrite('viewer')).toThrow();
    expect(() => assertWrite('member')).not.toThrow();
    expect(() => assertWrite('admin')).not.toThrow();
    expect(() => assertWrite('owner')).not.toThrow();
  });

  it('search_candidates passes tenantId=org into the service and returns JSON', async () => {
    const candidates = { findAll: jest.fn().mockResolvedValue({ candidates: [{ id: 'c1' }], total: 1 }) };
    const server = new McpServer({ name: 't', version: '1' });
    registerReadTools(server, { candidates, jobs: {} as any, candidateAi: {} as any } as any);
    // Access the registered tool's handler via the server's internal registry.
    // (Installed SDK stores the tool callback under `.handler`, not `.callback`.)
    const tool = (server as any)._registeredTools['search_candidates'];
    const result = await tool.handler({ q: 'eng' }, { authInfo: { extra: { org: 'o9', role: 'viewer' } } });
    expect(candidates.findAll).toHaveBeenCalledWith('o9', 'eng', undefined, undefined, undefined);
    expect(JSON.parse(result.content[0].text).total).toBe(1);
  });
});
