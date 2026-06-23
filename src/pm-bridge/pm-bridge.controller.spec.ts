import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PmBridgeController } from './pm-bridge.controller';
import { PmBridgeService } from './pm-bridge.service';
import { SessionGuard } from '../auth/session.guard';
import { PmBridgeGuard } from './pm-bridge.guard';

const mockReq: any = { session: { sub: 'user-1', org: 'tenant-1' }, pmBridgeEmail: 'pm@x.com' };
const page = { name: 'Talent Pool', route: '/talent-pool' };

const mockService = {
  converse: jest.fn().mockResolvedValue({ type: 'clarify', questions: [] }),
  commit: jest.fn().mockResolvedValue({ type: 'filed' }),
  listDecisions: jest.fn().mockResolvedValue([]),
  createDecision: jest.fn(),
  updateDecision: jest.fn(),
};

async function buildController() {
  const module = await Test.createTestingModule({
    controllers: [PmBridgeController],
    providers: [{ provide: PmBridgeService, useValue: mockService }],
  })
    .overrideGuard(SessionGuard).useValue({ canActivate: () => true })
    .overrideGuard(PmBridgeGuard).useValue({ canActivate: () => true })
    .compile();
  return module.get(PmBridgeController);
}

beforeEach(() => jest.clearAllMocks());

describe('PmBridgeController', () => {
  it('converse passes parsed body + tenant/email to the service', async () => {
    const c = await buildController();
    await c.converse({ messages: [{ role: 'pm', content: 'search slow' }], page }, mockReq);
    expect(mockService.converse).toHaveBeenCalledWith(
      { messages: [{ role: 'pm', content: 'search slow' }], page }, 'tenant-1', 'pm@x.com',
    );
  });

  it('converse rejects an invalid body with 400', async () => {
    const c = await buildController();
    await expect(c.converse({ messages: [] }, mockReq)).rejects.toThrow(BadRequestException);
  });

  it('commit forwards a valid brief', async () => {
    const c = await buildController();
    const brief = {
      goal: 'g', problem: 'p', desiredOutcomes: [], constraints: [], affectedArea: page,
      sizeHint: 'tiny', devNotes: [], rawText: 'r', conversationDigest: 'd',
    };
    await c.commit({ brief, page }, mockReq);
    expect(mockService.commit).toHaveBeenCalledWith({ brief, page }, 'tenant-1', 'pm@x.com');
  });

  it('createDecision rejects empty statement', async () => {
    const c = await buildController();
    await expect(c.createDecision({ statement: '' }, mockReq)).rejects.toThrow(BadRequestException);
  });

  it('listDecisions returns service result', async () => {
    const c = await buildController();
    mockService.listDecisions.mockResolvedValue([{ id: '1' }]);
    const result = await c.listDecisions(mockReq);
    expect(result).toEqual([{ id: '1' }]);
  });

  it('updateDecision rejects invalid status value', async () => {
    const c = await buildController();
    await expect(c.updateDecision('id-1', { status: 'deleted' }, mockReq)).rejects.toThrow(BadRequestException);
  });
});
