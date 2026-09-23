import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DenyViewerGuard } from './deny-viewer.guard';
import { JwtPayload } from './jwt.service';

const contextWith = (session?: JwtPayload): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ session }) }) }) as unknown as ExecutionContext;

const session = (role: JwtPayload['role']): JwtPayload => ({ sub: 'u1', org: 'o1', role });

describe('DenyViewerGuard', () => {
  const guard = new DenyViewerGuard();

  it('refuses a viewer with 403 FORBIDDEN in the standard error shape', () => {
    let thrown: unknown;
    try {
      guard.canActivate(contextWith(session('viewer')));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).getResponse()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Viewers have read-only access' },
    });
  });

  it.each(['member', 'admin', 'owner'] as const)('lets a %s through', (role) => {
    expect(guard.canActivate(contextWith(session(role)))).toBe(true);
  });

  it('fails closed when there is no session', () => {
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
