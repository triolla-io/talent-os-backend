import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { McpOAuthStore } from './mcp-oauth.store';
import { McpTokenService } from './mcp-token.service';
import { AuthService } from '../auth/auth.service';
import { renderGoogleLoginPage } from './google-login.page';

@Injectable()
export class McpOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: McpOAuthStore,
    private readonly tokens: McpTokenService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (id: string) => this.store.getClient(id),
      // The SDK's registration handler generates client_id/client_id_issued_at before
      // calling registerClient, so at runtime the object is a complete OAuthClientInformationFull.
      registerClient: async (client) => {
        const full = client as OAuthClientInformationFull;
        await this.store.saveClient(full);
        return full;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const loginSessionId = randomUUID();
    await this.store.saveLoginSession(loginSessionId, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes ?? ['mcp'],
    });
    const base = this.config.getOrThrow<string>('MCP_PUBLIC_URL').replace(/\/$/, '');
    res.send(
      renderGoogleLoginPage({
        loginSessionId,
        googleClientId: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
        completeUrl: `${base}/mcp-oauth/complete`,
      }),
    );
  }

  // Called by the completion controller after the browser gets a Google access token.
  async completeLogin(loginSessionId: string, googleAccessToken: string): Promise<{ redirect: string }> {
    const session = await this.store.takeLoginSession(loginSessionId);
    if (!session) throw new Error('Login session expired or invalid');

    const { meResponse } = await this.authService.googleVerify(googleAccessToken);
    const role = meResponse.role as 'owner' | 'admin' | 'member' | 'viewer';

    const code = randomUUID();
    await this.store.saveAuthCode(code, {
      clientId: session.clientId,
      redirectUri: session.redirectUri,
      codeChallenge: session.codeChallenge,
      sub: meResponse.id,
      org: meResponse.org_id,
      role,
    });

    const url = new URL(session.redirectUri);
    url.searchParams.set('code', code);
    if (session.state) url.searchParams.set('state', session.state);
    return { redirect: url.toString() };
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    // Non-destructive peek: the SDK's tokenHandler calls this immediately before
    // exchangeAuthorizationCode (which consumes the code via takeAuthCode).
    const data = await this.store.peekAuthCode(authorizationCode);
    if (!data) throw new Error('Invalid authorization code');
    return data.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const data = await this.store.takeAuthCode(authorizationCode);
    if (!data || data.clientId !== client.client_id) throw new Error('Invalid authorization code');

    const role = data.role as 'owner' | 'admin' | 'member' | 'viewer';
    const access_token = await this.tokens.signAccess({ sub: data.sub, org: data.org, role });
    const refresh_token = await this.tokens.signRefresh({ sub: data.sub, org: data.org, role });
    await this.store.saveRefreshToken(refresh_token, data.sub);

    return { access_token, token_type: 'bearer', expires_in: 900, refresh_token, scope: 'mcp' };
  }

  async exchangeRefreshToken(_client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    if (!(await this.store.isRefreshTokenValid(refreshToken))) throw new Error('Invalid refresh token');
    const claims = await this.tokens.verifyRefresh(refreshToken);
    const user = { sub: claims.sub, org: claims.org, role: claims.role };
    const access_token = await this.tokens.signAccess(user);
    // OAuth 2.1 refresh rotation: each refresh token is single-use.
    const refresh_token = await this.tokens.signRefresh(user);
    await this.store.saveRefreshToken(refresh_token, claims.sub);
    await this.store.revokeRefreshToken(refreshToken);
    return { access_token, token_type: 'bearer', expires_in: 900, refresh_token, scope: 'mcp' };
  }

  // mcpAuthRouter exposes /revoke (and advertises revocation_endpoint) because this exists.
  // RFC 7009: revoking an unknown or already-revoked token is a success no-op. Access tokens
  // are stateless 15-minute JWTs and expire on their own; only refresh tokens live in Redis.
  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.store.revokeRefreshToken(request.token);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const claims = await this.tokens.verifyAccess(token);
    return {
      token,
      clientId: claims.sub,
      scopes: ['mcp'],
      // requireBearerAuth rejects tokens without a numeric expiresAt (seconds since epoch).
      expiresAt: claims.exp,
      extra: { userId: claims.sub, org: claims.org, role: claims.role },
    };
  }
}
