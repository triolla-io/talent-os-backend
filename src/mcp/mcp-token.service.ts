import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';

export interface McpClaims {
  sub: string;
  org: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  scope: 'mcp';
  // Distinguishes the two token kinds. Without it a 30-day refresh token would pass
  // bearer auth on /mcp, defeating the 15-minute access expiry and Redis revocation.
  typ: 'access' | 'refresh';
  aud: string;
  exp?: number; // seconds since epoch (set by setExpirationTime; needed by requireBearerAuth)
  iat?: number;
}

@Injectable()
export class McpTokenService {
  private readonly secret: Uint8Array;
  private readonly audience: string;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.getOrThrow<string>('MCP_JWT_SECRET');
    this.secret = new TextEncoder().encode(raw);
    this.audience = this.configService.getOrThrow<string>('MCP_PUBLIC_URL');
  }

  private sign(
    p: { sub: string; org: string; role: McpClaims['role'] },
    typ: McpClaims['typ'],
    expiresIn: string,
  ): Promise<string> {
    return new SignJWT({ org: p.org, role: p.role, scope: 'mcp', typ })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.sub)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  signAccess(p: { sub: string; org: string; role: McpClaims['role'] }): Promise<string> {
    return this.sign(p, 'access', '15m');
  }

  signRefresh(p: { sub: string; org: string; role: McpClaims['role'] }): Promise<string> {
    return this.sign(p, 'refresh', '30d');
  }

  private async verify(token: string, typ: McpClaims['typ']): Promise<McpClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { audience: this.audience });
      if (payload.scope !== 'mcp') throw new Error('wrong scope');
      if (payload.typ !== typ) throw new Error('wrong token type');
      return payload as unknown as McpClaims;
    } catch {
      throw new UnauthorizedException('Invalid or expired MCP token');
    }
  }

  verifyAccess(token: string): Promise<McpClaims> {
    return this.verify(token, 'access');
  }

  verifyRefresh(token: string): Promise<McpClaims> {
    return this.verify(token, 'refresh');
  }
}
