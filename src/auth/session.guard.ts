import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService, JwtPayload } from './jwt.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

// Augment Express Request so TypeScript accepts request['session']
declare module 'express' {
  interface Request {
    session?: JwtPayload;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Registered globally (APP_GUARD), so every route requires a session by default.
    // Routes/controllers marked @Public() opt out — pre-auth flows, health probes, and
    // signature-verified webhooks that carry their own auth instead of a session cookie.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token: string | undefined = request.cookies?.['talent_os_session'];
    if (!token) throw new UnauthorizedException('No session cookie');
    // JwtService.verify() throws UnauthorizedException on invalid/expired token
    const payload = await this.jwtService.verify(token);
    request.session = payload;
    return true;
  }
}
