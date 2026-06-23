import { PmAiService } from './pm-ai.service';

jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: jest.fn(() => ({ chat: jest.fn(() => 'mock-model') })),
}));

import { generateObject } from 'ai';

beforeEach(() => jest.clearAllMocks());

function makeService() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'OPENROUTER_API_KEY') return 'test-key';
      if (key === 'PM_BRIDGE_MODEL') return 'anthropic/claude-sonnet-4.6';
      return undefined;
    }),
  };
  return new PmAiService(config as any);
}

describe('PmAiService.clarify', () => {
  it('returns a clarify result with questions', async () => {
    (generateObject as jest.Mock).mockResolvedValue({
      object: { type: 'clarify', questions: [{ id: 'q1', prompt: 'Slow or wrong?', chips: ['Slow', 'Wrong'], allowFreeText: true }], goal: '', brief: null },
    });
    const svc = makeService();
    const result = await svc.clarify({
      messages: [{ role: 'pm', content: 'search is bad' }],
      board: [], decisions: [], page: { name: 'Talent Pool', route: '/talent-pool' }, roundsUsed: 0,
    });
    expect(result.type).toBe('clarify');
    expect(result.questions[0].chips).toContain('Slow');
  });

  it('feeds the board and decisions into the prompt so it can ask a plain dedup question', async () => {
    (generateObject as jest.Mock).mockResolvedValue({ object: { type: 'clarify', questions: [], goal: '', brief: null } });
    const svc = makeService();
    await svc.clarify({
      messages: [{ role: 'pm', content: 'speed up search' }],
      board: [{ key: 'TO-1', type: 'Story', summary: 'Improve search speed', status: 'In Progress' }],
      decisions: [{ id: 'd1', statement: 'No dark mode', status: 'active' } as any],
      page: { name: 'Talent Pool', route: '/talent-pool' },
      roundsUsed: 1,
    });
    const call = (generateObject as jest.Mock).mock.calls[0][0];
    expect(call.prompt).toContain('Improve search speed');
    expect(call.prompt).toContain('No dark mode');
    expect(call.prompt).toContain('search');           // the transcript
    expect(call.schemaName).toBe('PmBridgeClarify');
  });
});
