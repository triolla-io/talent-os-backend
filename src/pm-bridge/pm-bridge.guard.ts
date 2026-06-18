import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

declare module 'express' {
  interface Request {
    pmBridgeEmail?: string;
  }
}

@Injectable()
export class PmBridgeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const userId = req.session!.sub;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new ForbiddenException({ error: { code: 'FORBIDDEN', message: 'Not authorized for PM Bridge' } });
    }

    const email = user.email.toLowerCase();
    const rawList = this.config.get<string>('PM_BRIDGE_ALLOWLIST') ?? '';
    const allowlist = new Set(
      rawList
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );

    if (!allowlist.has(email)) {
      throw new ForbiddenException({ error: { code: 'FORBIDDEN', message: 'Not authorized for PM Bridge' } });
    }

    req.pmBridgeEmail = email;
    return true;
  }
}
