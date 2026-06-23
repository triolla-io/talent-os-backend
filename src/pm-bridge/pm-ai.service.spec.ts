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

const sampleBrief = {
  goal: 'Make candidate search fast',
  problem: 'Search takes several seconds on big lists',
  desiredOutcomes: ['results under 1s'],
  constraints: [],
  affectedArea: { name: 'Talent Pool', route: '/talent-pool' },
  sizeHint: 'medium' as const,
  devNotes: ['add index on search column'],
  rawText: 'search is too slow',
  conversationDigest: 'pm wants faster candidate search',
};

describe('PmAiService.validate', () => {
  it('returns a conflict verdict with a plain reason', async () => {
    (generateObject as jest.Mock).mockResolvedValue({
      object: { status: 'conflict', duplicateOfKey: null, reasonPlain: 'It undoes the read-only rule.', related: [], conflictingDecisionIds: ['d1'] },
    });
    const svc = makeService();
    const r = await svc.validate({ brief: sampleBrief, board: [], decisions: [] });
    expect(r.status).toBe('conflict');
    expect(r.reasonPlain).toContain('read-only');
  });
});

describe('PmAiService.decompose', () => {
  it('returns a sized issue tree', async () => {
    (generateObject as jest.Mock).mockResolvedValue({
      object: { size: 'medium', root: { issueType: 'Story', summary: 'Fast search', description: 'd', acceptanceCriteria: ['<1s'], children: [], subtasks: [{ summary: 'add index', description: 'd' }] } },
    });
    const svc = makeService();
    const r = await svc.decompose({ brief: sampleBrief });
    expect(r.size).toBe('medium');
    expect(r.root.subtasks).toHaveLength(1);
    const call = (generateObject as jest.Mock).mock.calls[0][0];
    expect(call.schemaName).toBe('PmBridgeDecompose');
    expect(call.prompt).toContain('Make candidate search fast');
  });
});
