import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtPayload } from './jwt.service';

const WRITE_FORBIDDEN_ROLES: JwtPayload['role'][] = ['viewer'];

/**
 * Viewers are read-only (spec/auth-rules.md AUTH-006) — the D-18 viewer check as a guard, so
 * a mutation handler opts in with one decorator. Runs after SessionGuard, so request.session
 * is DB-fresh. No session is refused too: the guard fails closed on a misplaced @Public().
 */
@Injectable()
export class DenyViewerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const session = context.switchToHttp().getRequest<Request>().session;
    if (!session || WRITE_FORBIDDEN_ROLES.includes(session.role)) {
      throw new ForbiddenException({ error: { code: 'FORBIDDEN', message: 'Viewers have read-only access' } });
    }
    return true;
  }
}

/** Put on every mutation handler: viewers get 403 FORBIDDEN, every other role passes. */
export const DenyViewer = (): MethodDecorator & ClassDecorator => UseGuards(DenyViewerGuard);
