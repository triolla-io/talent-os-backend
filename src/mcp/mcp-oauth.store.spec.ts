const store: Record<string, string> = {};
const mockRedis = {
  set: jest.fn(async (k: string, v: string) => {
    store[k] = v;
    return 'OK';
  }),
  get: jest.fn(async (k: string) => store[k] ?? null),
  getdel: jest.fn(async (k: string) => {
    const v = store[k] ?? null;
    delete store[k];
    return v;
  }),
  del: jest.fn(async (k: string) => {
    delete store[k];
    return 1;
  }),
};
jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedis));

import { ConfigService } from '@nestjs/config';
import { McpOAuthStore } from './mcp-oauth.store';

const cfg = { getOrThrow: () => 'redis://localhost:6379' } as unknown as ConfigService;

describe('McpOAuthStore', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    jest.clearAllMocks();
  });
  const s = new McpOAuthStore(cfg);

  it('round-trips a client', async () => {
    await s.saveClient({ client_id: 'c1', redirect_uris: ['https://x/cb'] } as any);
    expect((await s.getClient('c1'))?.client_id).toBe('c1');
  });

  it('auth codes are single-use', async () => {
    await s.saveAuthCode('code1', {
      clientId: 'c1',
      redirectUri: 'https://x/cb',
      codeChallenge: 'ch',
      sub: 'u',
      org: 'o',
      role: 'admin',
    });
    expect((await s.takeAuthCode('code1'))?.sub).toBe('u');
    expect(await s.takeAuthCode('code1')).toBeNull();
  });

  it('refresh tokens can be validated and revoked', async () => {
    await s.saveRefreshToken('rt', 'u1');
    expect(await s.isRefreshTokenValid('rt')).toBe(true);
    await s.revokeRefreshToken('rt');
    expect(await s.isRefreshTokenValid('rt')).toBe(false);
  });
});
