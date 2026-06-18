import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PmBridgeGuard } from './pm-bridge.guard';

function makeContext(sub: string): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { session: { sub } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('PmBridgeGuard', () => {
  function makeGuard(user: object | null, allowlist: string) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
    };
    const config = {
      get: jest.fn((key: string) => (key === 'PM_BRIDGE_ALLOWLIST' ? allowlist : undefined)),
    };
    return new PmBridgeGuard(prisma as any, config as any);
  }

  it('allows an allowlisted active user', async () => {
    const guard = makeGuard({ id: '1', email: 'pm@example.com', isActive: true }, 'pm@example.com');
    const { ctx, req } = makeContext('1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.pmBridgeEmail).toBe('pm@example.com');
  });

  it('rejects a non-allowlisted user', async () => {
    const guard = makeGuard({ id: '1', email: 'other@example.com', isActive: true }, 'pm@example.com');
    const { ctx } = makeContext('1');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a missing user', async () => {
    const guard = makeGuard(null, 'pm@example.com');
    const { ctx } = makeContext('1');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('rejects an inactive user', async () => {
    const guard = makeGuard({ id: '1', email: 'pm@example.com', isActive: false }, 'pm@example.com');
    const { ctx } = makeContext('1');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('is case-insensitive and trims whitespace in allowlist', async () => {
    const guard = makeGuard({ id: '1', email: 'PM@Example.COM', isActive: true }, '  PM@EXAMPLE.COM  ');
    const { ctx } = makeContext('1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
