import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PmBridgeService } from './pm-bridge.service';

const cleanVerdict = {
  draft: { issueType: 'Story', summary: 'S', description: 'D', acceptanceCriteria: [] },
  verdict: { status: 'clean', relatedTickets: [], conflictingDecisions: [], recommendedAction: 'create' },
};
const dirtyVerdict = { ...cleanVerdict, verdict: { ...cleanVerdict.verdict, status: 'duplicate' } };

function makeService(verdictOverride = cleanVerdict) {
  const prisma = {
    pmProductDecision: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'new-id', ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where.id })),
    },
  };
  const jiraGateway = {
    readBoard: jest.fn().mockResolvedValue([]),
    createIssue: jest.fn().mockResolvedValue({ key: 'TO-99', url: 'https://example.com/TO-99' }),
    updateIssue: jest.fn().mockResolvedValue({ key: 'TO-5', url: 'https://example.com/TO-5' }),
  };
  const pmAi = { draftAndValidate: jest.fn().mockResolvedValue(verdictOverride) };
  return { service: new PmBridgeService(prisma as any, jiraGateway as any, pmAi as any), prisma, jiraGateway, pmAi };
}

const baseIssue = { issueType: 'Story' as const, summary: 'S', description: 'D', acceptanceCriteria: [] };

describe('PmBridgeService — commit gate', () => {
  it('clean-create writes successfully', async () => {
    const { service, jiraGateway } = makeService();
    const result = await service.commit({ action: 'create', issue: baseIssue }, 'tenant-1', 'pm@x.com');
    expect(jiraGateway.createIssue).toHaveBeenCalled();
    expect(result.key).toBe('TO-99');
  });

  it('non-clean + overrideReason writes successfully', async () => {
    const { service, jiraGateway } = makeService(dirtyVerdict as any);
    await service.commit({ action: 'create', issue: baseIssue, overrideReason: 'intentional' }, 'tenant-1', 'pm@x.com');
    expect(jiraGateway.createIssue).toHaveBeenCalled();
  });

  it('non-clean + no overrideReason throws 409 with verdict', async () => {
    const { service } = makeService(dirtyVerdict as any);
    await expect(
      service.commit({ action: 'create', issue: baseIssue }, 'tenant-1', 'pm@x.com'),
    ).rejects.toThrow(ConflictException);
  });

  it('update requires targetKey — throws 400 without it', async () => {
    const { service } = makeService();
    await expect(
      service.commit({ action: 'update', issue: baseIssue }, 'tenant-1', 'pm@x.com'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update with targetKey writes successfully', async () => {
    const { service, jiraGateway } = makeService();
    await service.commit({ action: 'update', issue: baseIssue, targetKey: 'TO-5' }, 'tenant-1', 'pm@x.com');
    expect(jiraGateway.updateIssue).toHaveBeenCalledWith('TO-5', baseIssue);
  });

  it('update skips AI validation and board read (no wasted work)', async () => {
    const { service, jiraGateway, pmAi } = makeService();
    await service.commit({ action: 'update', issue: baseIssue, targetKey: 'TO-5' }, 'tenant-1', 'pm@x.com');
    expect(pmAi.draftAndValidate).not.toHaveBeenCalled();
    expect(jiraGateway.readBoard).not.toHaveBeenCalled();
    expect(jiraGateway.updateIssue).toHaveBeenCalledWith('TO-5', baseIssue);
  });

  it('create validates the full submitted issue, not just the summary', async () => {
    const { service, pmAi } = makeService();
    const issue = {
      issueType: 'Story' as const,
      summary: 'Add login',
      description: 'Users sign in',
      acceptanceCriteria: ['Shows email field'],
    };
    await service.commit({ action: 'create', issue }, 'tenant-1', 'pm@x.com');
    const text = pmAi.draftAndValidate.mock.calls[0][0].text as string;
    expect(text).toContain('Add login');
    expect(text).toContain('Users sign in');
    expect(text).toContain('Shows email field');
  });

  it('supersedesDecisionId marks decision superseded after successful write', async () => {
    const { service, prisma } = makeService();
    await service.commit(
      { action: 'create', issue: baseIssue, supersedesDecisionId: 'dec-uuid' },
      'tenant-1',
      'pm@x.com',
    );
    expect(prisma.pmProductDecision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'dec-uuid' }) }),
    );
  });
});

describe('PmBridgeService — decisions CRUD', () => {
  it('listDecisions is tenant-scoped', async () => {
    const { service, prisma } = makeService();
    await service.listDecisions('tenant-abc');
    expect(prisma.pmProductDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-abc' }) }),
    );
  });

  it('createDecision is tenant-scoped', async () => {
    const { service, prisma } = makeService();
    await service.createDecision({ statement: 'No dark mode' }, 'tenant-abc', 'pm@x.com');
    expect(prisma.pmProductDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-abc' }) }),
    );
  });

  it('updateDecision throws 404 when decision not found for tenant', async () => {
    const { service, prisma } = makeService();
    prisma.pmProductDecision.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateDecision('missing-id', { status: 'superseded' }, 'tenant-abc')).rejects.toThrow(
      NotFoundException,
    );
  });
});
