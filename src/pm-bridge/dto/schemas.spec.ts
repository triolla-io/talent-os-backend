import { ConverseRequestSchema } from './converse.dto';
import { CommitRequestSchema } from './commit.dto';
import { DecomposeResultSchema, ClarifyResultSchema } from './ai-output.dto';

const brief = {
  goal: 'Make search fast',
  problem: 'Search is slow',
  desiredOutcomes: ['fast'],
  constraints: [],
  affectedArea: { name: 'Talent Pool', route: '/talent-pool' },
  sizeHint: 'medium' as const,
  devNotes: [],
  rawText: 'search is slow',
  conversationDigest: 'pm wants faster search',
};

describe('PM Bridge schemas', () => {
  it('ConverseRequest requires at least one message', () => {
    expect(ConverseRequestSchema.safeParse({ messages: [], page: { name: 'X', route: '/' } }).success).toBe(false);
    expect(
      ConverseRequestSchema.safeParse({
        messages: [{ role: 'pm', content: 'search is slow' }],
        page: { name: 'Talent Pool', route: '/talent-pool' },
      }).success,
    ).toBe(true);
  });

  it('CommitRequest carries a full InternalBrief', () => {
    expect(CommitRequestSchema.safeParse({ brief, page: brief.affectedArea }).success).toBe(true);
  });

  it('DecomposeResult parses an Epic with a child + subtask', () => {
    const r = DecomposeResultSchema.safeParse({
      size: 'large',
      root: {
        issueType: 'Epic', summary: 'E', description: 'D', acceptanceCriteria: [], subtasks: [],
        children: [{ issueType: 'Story', summary: 'S', description: 'D', acceptanceCriteria: ['ac'], subtasks: [{ summary: 'st', description: 'd' }] }],
      },
    });
    expect(r.success).toBe(true);
  });

  it('ClarifyResult parses a clarify turn and a ready turn', () => {
    expect(ClarifyResultSchema.safeParse({ type: 'clarify', questions: [{ id: 'q1', prompt: 'slow or wrong?', chips: ['slow', 'wrong'], allowFreeText: true }], goal: '', brief: null }).success).toBe(true);
    expect(ClarifyResultSchema.safeParse({ type: 'ready', questions: [], goal: 'Make search fast', brief }).success).toBe(true);
  });
});
