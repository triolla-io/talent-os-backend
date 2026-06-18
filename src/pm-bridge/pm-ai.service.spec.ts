import { PmAiService } from './pm-ai.service';

jest.mock('ai', () => ({ generateObject: jest.fn() }));
jest.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: jest.fn(() => ({ chat: jest.fn(() => 'mock-model') })),
}));

import { generateObject } from 'ai';

beforeEach(() => jest.clearAllMocks());

const validOutput = {
  draft: {
    issueType: 'Story',
    summary: 'Add login page',
    description: 'Users need a login page',
    acceptanceCriteria: ['Shows email + password fields', 'Validates credentials'],
  },
  verdict: {
    status: 'clean',
    relatedTickets: [],
    conflictingDecisions: [],
    recommendedAction: 'create',
  },
};

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

describe('PmAiService', () => {
  it('returns parsed DraftVerdict on valid model output', async () => {
    (generateObject as jest.Mock).mockResolvedValue({ object: validOutput });
    const svc = makeService();
    const result = await svc.draftAndValidate({
      text: 'We need a login page',
      tickets: [],
      decisions: [],
    });
    expect(result.verdict.status).toBe('clean');
    expect(result.draft.issueType).toBe('Story');
  });

  it('includes tickets and decisions in the prompt passed to generateObject', async () => {
    (generateObject as jest.Mock).mockResolvedValue({ object: validOutput });
    const svc = makeService();
    await svc.draftAndValidate({
      text: 'test',
      tickets: [{ key: 'TO-1', type: 'Story', summary: 'Existing ticket', status: 'In Progress' }],
      decisions: [
        { id: 'd1', statement: 'No dark mode', status: 'active' } as any,
      ],
    });
    const call = (generateObject as jest.Mock).mock.calls[0][0];
    expect(call.prompt).toContain('TO-1');
    expect(call.prompt).toContain('No dark mode');
  });

  it('propagates errors from generateObject', async () => {
    (generateObject as jest.Mock).mockRejectedValue(new Error('AI failure'));
    const svc = makeService();
    await expect(
      svc.draftAndValidate({ text: 'x', tickets: [], decisions: [] }),
    ).rejects.toThrow('AI failure');
  });
});
