import { NotFoundException } from '@nestjs/common';
import { PmBridgeService } from './pm-bridge.service';

const brief = {
  goal: 'Make search fast', problem: 'slow', desiredOutcomes: [], constraints: [],
  affectedArea: { name: 'Talent Pool', route: '/talent-pool' }, sizeHint: 'medium' as const,
  devNotes: [], rawText: 'search slow', conversationDigest: 'faster search',
};
const page = brief.affectedArea;

function make(overrides: any = {}) {
  const prisma = {
    pmProductDecision: { findMany: jest.fn().mockResolvedValue([]) },
    pmHeldRequest: {
      create: jest.fn().mockResolvedValue({ id: 'hold-1' }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const jira = {
    readBoard: jest.fn().mockResolvedValue([]),
    createIssueTree: jest.fn().mockResolvedValue({ keys: ['TO-1', 'TO-2'] }),
    addComment: jest.fn().mockResolvedValue(undefined),
  };
  const ai = {
    clarify: jest.fn(),
    validate: jest.fn(),
    decompose: jest.fn().mockResolvedValue({ size: 'medium', root: { issueType: 'Story', summary: 'S', description: 'd', acceptanceCriteria: [], children: [], subtasks: [] } }),
  };
  const notify = { notifyHeld: jest.fn().mockResolvedValue(undefined) };
  Object.assign(ai, overrides.ai);
  return { svc: new PmBridgeService(prisma as any, jira as any, ai as any, notify as any), prisma, jira, ai, notify };
}

describe('PmBridgeService.converse', () => {
  it('passes through a clarify result', async () => {
    const { svc, ai } = make();
    ai.clarify.mockResolvedValue({ type: 'clarify', questions: [{ id: 'q1', prompt: 'slow or wrong?', chips: [], allowFreeText: true }], goal: '', brief: null });
    const r = await svc.converse({ messages: [{ role: 'pm', content: 'bad search' }], page }, 'tenant-1', 'pm@x.com');
    expect(r).toEqual({ type: 'clarify', questions: [{ id: 'q1', prompt: 'slow or wrong?', chips: [], allowFreeText: true }] });
  });

  it('returns ready + brief when the AI is satisfied', async () => {
    const { svc, ai } = make();
    ai.clarify.mockResolvedValue({ type: 'ready', questions: [], goal: 'Make search fast', brief });
    const r = await svc.converse({ messages: [{ role: 'pm', content: 'x' }], page }, 'tenant-1', 'pm@x.com');
    expect(r).toEqual({ type: 'ready', goal: 'Make search fast', brief });
  });

  it('holds for Daniel when still unclear after the max rounds', async () => {
    const { svc, ai, prisma, notify } = make();
    ai.clarify.mockResolvedValue({ type: 'clarify', questions: [{ id: 'q', prompt: '?', chips: [], allowFreeText: true }], goal: '', brief: null });
    // 3 assistant turns already used → cap reached
    const messages = [
      { role: 'pm', content: 'a' }, { role: 'assistant', content: 'q1' },
      { role: 'pm', content: 'b' }, { role: 'assistant', content: 'q2' },
      { role: 'pm', content: 'c' }, { role: 'assistant', content: 'q3' },
      { role: 'pm', content: 'd' },
    ];
    const r = await svc.converse({ messages, page } as any, 'tenant-1', 'pm@x.com');
    expect(r).toEqual({ type: 'held' });
    expect(prisma.pmHeldRequest.create).toHaveBeenCalled();
    expect(notify.notifyHeld).toHaveBeenCalled();
  });
});

describe('PmBridgeService.commit', () => {
  it('clean → builds the tree and files', async () => {
    const { svc, ai, jira } = make();
    ai.validate.mockResolvedValue({ status: 'clean', duplicateOfKey: null, reasonPlain: '', related: [], conflictingDecisionIds: [] });
    const r = await svc.commit({ brief, page }, 'tenant-1', 'pm@x.com');
    expect(jira.createIssueTree).toHaveBeenCalled();
    expect(r).toEqual({ type: 'filed' });
  });

  it('duplicate → folds a comment, files nothing', async () => {
    const { svc, ai, jira } = make();
    ai.validate.mockResolvedValue({ status: 'duplicate', duplicateOfKey: 'TO-9', reasonPlain: 'same', related: [], conflictingDecisionIds: [] });
    const r = await svc.commit({ brief, page }, 'tenant-1', 'pm@x.com');
    expect(jira.addComment).toHaveBeenCalledWith('TO-9', expect.stringContaining('Make search fast'));
    expect(jira.createIssueTree).not.toHaveBeenCalled();
    expect(r).toEqual({ type: 'merged' });
  });

  it('conflict → holds + notifies, files nothing', async () => {
    const { svc, ai, jira, prisma, notify } = make();
    ai.validate.mockResolvedValue({ status: 'conflict', duplicateOfKey: null, reasonPlain: 'breaks rule', related: [], conflictingDecisionIds: ['d1'] });
    const r = await svc.commit({ brief, page }, 'tenant-1', 'pm@x.com');
    expect(prisma.pmHeldRequest.create).toHaveBeenCalled();
    expect(notify.notifyHeld).toHaveBeenCalledWith(expect.objectContaining({ holdId: 'hold-1', reasonPlain: 'breaks rule' }));
    expect(jira.createIssueTree).not.toHaveBeenCalled();
    expect(r).toEqual({ type: 'held' });
  });
});

describe('PmBridgeService.approveHold / rejectHold', () => {
  it('approve builds the stored brief and marks approved', async () => {
    const { svc, prisma, jira } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue({ id: 'hold-1', status: 'pending', brief });
    const r = await svc.approveHold('hold-1');
    expect(jira.createIssueTree).toHaveBeenCalled();
    expect(prisma.pmHeldRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }));
    expect(r.status).toBe('approved');
  });

  it('approve on an already-resolved hold is a no-op', async () => {
    const { svc, prisma, jira } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue({ id: 'hold-1', status: 'approved', brief });
    const r = await svc.approveHold('hold-1');
    expect(r.status).toBe('already_resolved');
    expect(jira.createIssueTree).not.toHaveBeenCalled();
  });

  it('approve on a missing hold throws 404', async () => {
    const { svc, prisma } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue(null);
    await expect(svc.approveHold('nope')).rejects.toThrow(NotFoundException);
  });

  it('reject marks rejected without touching Jira', async () => {
    const { svc, prisma, jira } = make();
    prisma.pmHeldRequest.findUnique.mockResolvedValue({ id: 'hold-1', status: 'pending', brief });
    const r = await svc.rejectHold('hold-1');
    expect(r.status).toBe('rejected');
    expect(jira.createIssueTree).not.toHaveBeenCalled();
  });
});
