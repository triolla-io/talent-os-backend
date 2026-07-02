import { BadRequestException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWriteTools } from './write.tools';

function reg(services: any) {
  const server = new McpServer({ name: 't', version: '1' });
  registerWriteTools(server, services);
  return (name: string) => (server as any)._registeredTools[name];
}
const viewer = { authInfo: { extra: { org: 'o1', role: 'viewer' } } };
const member = { authInfo: { extra: { org: 'o1', role: 'member' } } };

describe('write tools', () => {
  it('move_candidate_stage is blocked for viewer', async () => {
    const get = reg({ candidates: { updateStage: jest.fn() } });
    const res = await get('move_candidate_stage').handler(
      { candidate_id: '11111111-1111-1111-1111-111111111111', hiring_stage_id: '22222222-2222-2222-2222-222222222222' },
      viewer,
    );
    expect(res.isError).toBe(true);
  });

  it('move_candidate_stage passes tenantId=org for member', async () => {
    const updateStage = jest.fn().mockResolvedValue(undefined);
    const get = reg({ candidates: { updateStage } });
    await get('move_candidate_stage').handler(
      { candidate_id: '11111111-1111-1111-1111-111111111111', hiring_stage_id: '22222222-2222-2222-2222-222222222222' },
      member,
    );
    expect(updateStage).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      { hiring_stage_id: '22222222-2222-2222-2222-222222222222' },
      'o1',
    );
  });

  it('create_job passes tenantId=org for member', async () => {
    const createJob = jest.fn().mockResolvedValue({ id: 'j1' });
    const get = reg({ jobs: { createJob } });
    await get('create_job').handler({ title: 'Engineer' }, member);
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ title: 'Engineer' }), 'o1');
  });

  it('surfaces nested HttpException messages instead of the exception class name', async () => {
    const updateStage = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException({ error: { code: 'INVALID_STAGE', message: 'Stage does not belong to the job.' } }),
      );
    const get = reg({ candidates: { updateStage } });
    const res = await get('move_candidate_stage').handler(
      { candidate_id: '11111111-1111-1111-1111-111111111111', hiring_stage_id: '22222222-2222-2222-2222-222222222222' },
      member,
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Stage does not belong to the job.');
  });
});
