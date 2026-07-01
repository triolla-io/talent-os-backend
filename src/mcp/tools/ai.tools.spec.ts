import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAiTools } from './ai.tools';

function reg(services: any) {
  const server = new McpServer({ name: 't', version: '1' });
  registerAiTools(server, services);
  return (name: string) => (server as any)._registeredTools[name];
}
const member = { authInfo: { extra: { org: 'o1', role: 'member' } } };
const viewer = { authInfo: { extra: { org: 'o1', role: 'viewer' } } };
const CID = '11111111-1111-1111-1111-111111111111';

describe('ai tools', () => {
  it('rescore_candidate is blocked for viewer', async () => {
    const get = reg({ candidates: { rescoreCandidate: jest.fn() } });
    const res = await get('rescore_candidate').handler({ candidate_id: CID }, viewer);
    expect(res.isError).toBe(true);
  });

  it('rescore_candidate runs inline and returns the score', async () => {
    const rescoreCandidate = jest
      .fn()
      .mockResolvedValue({ score: 82, reasoning: 'r', strengths: [], gaps: [], modelUsed: 'm' });
    const get = reg({ candidates: { rescoreCandidate } });
    const res = await get('rescore_candidate').handler({ candidate_id: CID }, member);
    expect(rescoreCandidate).toHaveBeenCalledWith(CID, 'o1');
    expect(JSON.parse(res.content[0].text).score).toBe(82);
  });

  it('rescore_candidate reports when there is no assigned job', async () => {
    const get = reg({ candidates: { rescoreCandidate: jest.fn().mockResolvedValue(null) } });
    const res = await get('rescore_candidate').handler({ candidate_id: CID }, member);
    expect(res.content[0].text).toMatch(/no assigned job|no CV/i);
  });
});
