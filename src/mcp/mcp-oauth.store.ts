import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export interface StoredAuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  sub: string;
  org: string;
  role: string;
}
export interface LoginSession {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
}

const CLIENT = (id: string) => `mcp:oauth:client:${id}`;
const LOGIN = (id: string) => `mcp:oauth:login:${id}`;
const CODE = (c: string) => `mcp:oauth:code:${c}`;
const REFRESH = (t: string) => `mcp:oauth:refresh:${t}`;

@Injectable()
export class McpOAuthStore {
  private readonly redis: Redis;
  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), { lazyConnect: true });
  }

  async saveClient(c: OAuthClientInformationFull): Promise<void> {
    // Clients are long-lived; DCR re-registers if evicted. 90-day TTL as a safety net.
    await this.redis.set(CLIENT(c.client_id), JSON.stringify(c), 'EX', 90 * 24 * 3600);
  }
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const raw = await this.redis.get(CLIENT(clientId));
    return raw ? (JSON.parse(raw) as OAuthClientInformationFull) : undefined;
  }

  async saveLoginSession(id: string, s: LoginSession): Promise<void> {
    await this.redis.set(LOGIN(id), JSON.stringify(s), 'EX', 600);
  }
  async takeLoginSession(id: string): Promise<LoginSession | null> {
    const raw = await this.redis.getdel(LOGIN(id));
    return raw ? (JSON.parse(raw) as LoginSession) : null;
  }

  async saveAuthCode(code: string, data: StoredAuthCode): Promise<void> {
    await this.redis.set(CODE(code), JSON.stringify(data), 'EX', 60);
  }
  async takeAuthCode(code: string): Promise<StoredAuthCode | null> {
    const raw = await this.redis.getdel(CODE(code));
    return raw ? (JSON.parse(raw) as StoredAuthCode) : null;
  }
  // Non-destructive read — used by challengeForAuthorizationCode (PKCE peek). The
  // single-use guarantee lives in exchangeAuthorizationCode, which uses takeAuthCode.
  async peekAuthCode(code: string): Promise<StoredAuthCode | null> {
    const raw = await this.redis.get(CODE(code));
    return raw ? (JSON.parse(raw) as StoredAuthCode) : null;
  }

  async saveRefreshToken(token: string, sub: string): Promise<void> {
    await this.redis.set(REFRESH(token), sub, 'EX', 30 * 24 * 3600);
  }
  async isRefreshTokenValid(token: string): Promise<boolean> {
    return (await this.redis.get(REFRESH(token))) !== null;
  }
  async revokeRefreshToken(token: string): Promise<void> {
    await this.redis.del(REFRESH(token));
  }
}
