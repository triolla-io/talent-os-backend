import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionGuard } from './session.guard';
import { JwtService } from './jwt.service';

describe('SessionGuard', () => {
  let guard: SessionGuard;
  let jwtService: Partial<JwtService>;
  let reflector: Pick<Reflector, 'getAllAndOverride'>;

  const makeContext = (cookies: Record<string, string> = {}): ExecutionContext => {
    const request: any = { cookies };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new SessionGuard(jwtService as JwtService, reflector as Reflector);
  });

  it('returns true without verifying a session when the route is @Public()', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when no cookie present on a protected route', async () => {
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('attaches decoded payload to request.session when the JWT is valid', async () => {
    const payload = { sub: 'u1', org: 'o1', role: 'admin' };
    (jwtService.verify as jest.Mock).mockResolvedValue(payload);
    const request: any = { cookies: { talent_os_session: 'good-token' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.session).toBe(payload);
  });
});
