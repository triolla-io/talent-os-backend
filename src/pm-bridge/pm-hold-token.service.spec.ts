import { UnauthorizedException } from '@nestjs/common';
import { PmHoldTokenService } from './pm-hold-token.service';

function make() {
  const config = { getOrThrow: jest.fn((k: string) => (k === 'PM_HOLD_TOKEN_SECRET' ? 's'.repeat(32) : (() => { throw new Error(k); })())) };
  return new PmHoldTokenService(config as any);
}

describe('PmHoldTokenService', () => {
  it('round-trips a hold id', async () => {
    const svc = make();
    const token = await svc.sign('hold-123');
    expect(await svc.verify(token)).toEqual({ itemId: 'hold-123' });
  });

  it('rejects a tampered token', async () => {
    const svc = make();
    const token = await svc.sign('hold-123');
    await expect(svc.verify(token + 'x')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const svc = make();
    const token = await svc.sign('hold-123', '-1s');
    await expect(svc.verify(token)).rejects.toThrow(UnauthorizedException);
  });
});
