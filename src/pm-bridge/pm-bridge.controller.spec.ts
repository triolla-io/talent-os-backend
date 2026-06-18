import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PmBridgeController } from './pm-bridge.controller';
import { PmBridgeService } from './pm-bridge.service';
import { SessionGuard } from '../auth/session.guard';
import { PmBridgeGuard } from './pm-bridge.guard';

const mockService = {
  draft: jest.fn(),
  commit: jest.fn(),
  listDecisions: jest.fn().mockResolvedValue([]),
  createDecision: jest.fn(),
  updateDecision: jest.fn(),
};

const mockReq = { session: { sub: 'user-1', org: 'tenant-1' }, pmBridgeEmail: 'pm@x.com' };

async function buildController() {
  const module = await Test.createTestingModule({
    controllers: [PmBridgeController],
    providers: [{ provide: PmBridgeService, useValue: mockService }],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PmBridgeGuard)
    .useValue({ canActivate: () => true })
    .compile();

  return module.get(PmBridgeController);
}

describe('PmBridgeController', () => {
  it('draft rejects malformed body with VALIDATION_ERROR', async () => {
    const ctrl = await buildController();
    await expect(ctrl.draft({ not: 'valid' }, mockReq as any)).rejects.toThrow(BadRequestException);
  });

  it('commit rejects malformed body with VALIDATION_ERROR', async () => {
    const ctrl = await buildController();
    await expect(ctrl.commit({ action: 'invalid' }, mockReq as any)).rejects.toThrow(BadRequestException);
  });

  it('createDecision rejects empty statement', async () => {
    const ctrl = await buildController();
    await expect(ctrl.createDecision({ statement: '' }, mockReq as any)).rejects.toThrow(BadRequestException);
  });

  it('listDecisions returns service result', async () => {
    const ctrl = await buildController();
    mockService.listDecisions.mockResolvedValue([{ id: '1' }]);
    const result = await ctrl.listDecisions(mockReq as any);
    expect(result).toEqual([{ id: '1' }]);
  });

  it('updateDecision rejects invalid status value', async () => {
    const ctrl = await buildController();
    await expect(ctrl.updateDecision('id-1', { status: 'deleted' }, mockReq as any)).rejects.toThrow(BadRequestException);
  });
});
