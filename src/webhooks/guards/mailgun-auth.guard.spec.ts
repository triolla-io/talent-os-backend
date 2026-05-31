import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailgunAuthGuard } from './mailgun-auth.guard';

const SIGNING_KEY = 'test-signing-key';

function buildContext(body: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body }),
    }),
  } as any;
}

function makeSignature(key: string, timestamp: string, token: string): string {
  return crypto
    .createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
}

function freshTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('MailgunAuthGuard', () => {
  let guard: MailgunAuthGuard;

  beforeEach(() => {
    const mockConfig = { get: jest.fn().mockReturnValue(SIGNING_KEY) } as unknown as ConfigService;
    guard = new MailgunAuthGuard(mockConfig);
  });

  it('throws UnauthorizedException when timestamp is missing', () => {
    const token = 'a'.repeat(50);
    const ctx = buildContext({ token, signature: makeSignature(SIGNING_KEY, '', token) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when token is missing', () => {
    const ts = freshTimestamp();
    const ctx = buildContext({ timestamp: ts, signature: makeSignature(SIGNING_KEY, ts, '') });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature is missing', () => {
    const ts = freshTimestamp();
    const ctx = buildContext({ timestamp: ts, token: 'a'.repeat(50) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when timestamp is older than 300 seconds', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 301);
    const token = 'b'.repeat(50);
    const ctx = buildContext({
      timestamp: staleTs,
      token,
      signature: makeSignature(SIGNING_KEY, staleTs, token),
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature is wrong', () => {
    const ts = freshTimestamp();
    const token = 'c'.repeat(50);
    const ctx = buildContext({ timestamp: ts, token, signature: 'deadbeef'.repeat(8) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true for a valid signature with a fresh timestamp', () => {
    const ts = freshTimestamp();
    const token = 'd'.repeat(50);
    const sig = makeSignature(SIGNING_KEY, ts, token);
    const ctx = buildContext({ timestamp: ts, token, signature: sig });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
