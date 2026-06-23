import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';

@Injectable()
export class PmHoldTokenService {
  private readonly secret: Uint8Array;

  constructor(config: ConfigService) {
    // jose requires Uint8Array, not a string. Own secret — NOT JWT_SECRET, so this
    // token can never function as a session cookie.
    this.secret = new TextEncoder().encode(config.getOrThrow<string>('PM_HOLD_TOKEN_SECRET'));
  }

  sign(itemId: string, expiresIn = '14d'): Promise<string> {
    return new SignJWT({ itemId, typ: 'pm-hold' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secret);
  }

  async verify(token: string): Promise<{ itemId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      if (payload.typ !== 'pm-hold' || typeof payload.itemId !== 'string') {
        throw new Error('wrong token type');
      }
      return { itemId: payload.itemId };
    } catch {
      throw new UnauthorizedException('Invalid or expired hold token');
    }
  }
}
