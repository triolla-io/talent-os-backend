import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { JwtService, JwtPayload } from './jwt.service';

// Augment Express Request so TypeScript accepts request['session']
declare module 'express' {
  interface Request {
    session?: JwtPayload;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token: string | undefined = request.cookies?.['talent_os_session'];
    if (!token) throw new UnauthorizedException('No session cookie');
    // JwtService.verify() throws UnauthorizedException on invalid/expired token
    const payload = await this.jwtService.verify(token);
    request.session = payload;
    return true;
  }
}
