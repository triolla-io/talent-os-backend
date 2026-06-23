import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PmHoldsController } from './pm-holds.controller';
import { PmBridgeService } from './pm-bridge.service';
import { PmHoldTokenService } from './pm-hold-token.service';
import { Reflector } from '@nestjs/core';

const service = {
  approveHold: jest.fn().mockResolvedValue({ status: 'approved', keys: ['TO-1'] }),
  rejectHold: jest.fn().mockResolvedValue({ status: 'rejected' }),
};
const tokens = { verify: jest.fn() };

async function build() {
  const module = await Test.createTestingModule({
    controllers: [PmHoldsController],
    providers: [
      { provide: PmBridgeService, useValue: service },
      { provide: PmHoldTokenService, useValue: tokens },
      Reflector,
    ],
  }).compile();
  return module.get(PmHoldsController);
}

beforeEach(() => jest.clearAllMocks());

describe('PmHoldsController', () => {
  it('GET approve renders a confirm form (no mutation)', async () => {
    const c = await build();
    const html = c.approvePage('hold-1', 'tok');
    expect(html).toContain('<form method="post"');
    expect(html).toContain('/api/pm-bridge/holds/hold-1/approve?t=tok');
    expect(service.approveHold).not.toHaveBeenCalled();
  });

  it('POST approve verifies the token then approves', async () => {
    tokens.verify.mockResolvedValue({ itemId: 'hold-1' });
    const c = await build();
    const html = await c.approve('hold-1', 'tok');
    expect(tokens.verify).toHaveBeenCalledWith('tok');
    expect(service.approveHold).toHaveBeenCalledWith('hold-1');
    expect(html).toContain('Approved');
  });

  it('POST approve refuses when token itemId mismatches the path id', async () => {
    tokens.verify.mockResolvedValue({ itemId: 'other' });
    const c = await build();
    const html = await c.approve('hold-1', 'tok');
    expect(service.approveHold).not.toHaveBeenCalled();
    expect(html).toContain('not valid');
  });

  it('GET approve rejects a malformed (non-UUID-shaped) hold id — no XSS reflection', async () => {
    const c = await build();
    expect(() => c.approvePage('<script>alert(1)</script>', 'tok')).toThrow(BadRequestException);
  });
});
