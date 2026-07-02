import { McpOAuthProvider } from './mcp-oauth.provider';

function makeProvider() {
  const codes: Record<string, any> = {};
  const logins: Record<string, any> = {};
  const refresh: Record<string, string> = {};
  const store = {
    getClient: jest.fn(async (id: string) => ({ client_id: id, redirect_uris: ['https://claude.ai/cb'] })),
    saveClient: jest.fn(),
    saveLoginSession: jest.fn(async (id, s) => {
      logins[id] = s;
    }),
    takeLoginSession: jest.fn(async (id) => {
      const v = logins[id] ?? null;
      delete logins[id];
      return v;
    }),
    saveAuthCode: jest.fn(async (c, d) => {
      codes[c] = d;
    }),
    takeAuthCode: jest.fn(async (c) => {
      const v = codes[c] ?? null;
      delete codes[c];
      return v;
    }),
    peekAuthCode: jest.fn(async (c) => codes[c] ?? null),
    saveRefreshToken: jest.fn(async (t, s) => {
      refresh[t] = s;
    }),
    isRefreshTokenValid: jest.fn(async (t) => t in refresh),
    revokeRefreshToken: jest.fn(),
  };
  const claims = { sub: 'u1', org: 'o1', role: 'admin', scope: 'mcp', aud: 'https://mcp' };
  const tokens = {
    signAccess: jest.fn(async () => 'access.jwt'),
    signRefresh: jest.fn(async () => 'new-refresh.jwt'),
    verifyAccess: jest.fn(async () => ({ ...claims, typ: 'access' })),
    verifyRefresh: jest.fn(async () => ({ ...claims, typ: 'refresh' })),
  };
  const auth = { googleVerify: jest.fn(async () => ({ meResponse: { id: 'u1', org_id: 'o1', role: 'admin' } })) };
  const cfg = { getOrThrow: (k: string) => (k === 'GOOGLE_CLIENT_ID' ? 'gid' : 'https://mcp') };
  const provider = new McpOAuthProvider(store as any, tokens as any, auth as any, cfg as any);
  return { provider, store, tokens, auth, codes };
}

describe('McpOAuthProvider', () => {
  it('authorize renders the Google login page and stores a login session', async () => {
    const { provider, store } = makeProvider();
    const res = { send: jest.fn() } as any;
    await provider.authorize(
      { client_id: 'c1' } as any,
      { redirectUri: 'https://claude.ai/cb', codeChallenge: 'ch', state: 'st', scopes: ['mcp'] } as any,
      res,
    );
    expect(store.saveLoginSession).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('gsi/client'));
  });

  it('completeLogin resolves the user and returns a redirect with a code', async () => {
    const { provider, store, auth } = makeProvider();
    await provider.authorize(
      { client_id: 'c1' } as any,
      { redirectUri: 'https://claude.ai/cb', codeChallenge: 'ch', state: 'st', scopes: ['mcp'] } as any,
      { send: jest.fn() } as any,
    );
    const sessionId = (store.saveLoginSession as jest.Mock).mock.calls[0][0];
    const { redirect } = await provider.completeLogin(sessionId, 'google-access-token');
    expect(auth.googleVerify).toHaveBeenCalledWith('google-access-token');
    expect(redirect).toMatch(/^https:\/\/claude\.ai\/cb\?code=.+&state=st$/);
  });

  it('exchangeAuthorizationCode returns tokens bound to the resolved user', async () => {
    const { provider, store } = makeProvider();
    await provider.authorize(
      { client_id: 'c1' } as any,
      { redirectUri: 'https://claude.ai/cb', codeChallenge: 'ch', scopes: ['mcp'] } as any,
      { send: jest.fn() } as any,
    );
    const sessionId = (store.saveLoginSession as jest.Mock).mock.calls[0][0];
    const { redirect } = await provider.completeLogin(sessionId, 'tok');
    const code = new URL(redirect).searchParams.get('code')!;
    const out = await provider.exchangeAuthorizationCode({ client_id: 'c1' } as any, code);
    expect(out).toMatchObject({ access_token: 'access.jwt', refresh_token: 'new-refresh.jwt', token_type: 'bearer' });
  });

  it('challengeForAuthorizationCode fails a used/invalid code lookup path', async () => {
    const { provider } = makeProvider();
    await expect(provider.exchangeAuthorizationCode({ client_id: 'c1' } as any, 'nope')).rejects.toThrow();
  });

  it('verifyAccessToken uses typ-checked access verification', async () => {
    const { provider, tokens } = makeProvider();
    const info = await provider.verifyAccessToken('access.jwt');
    expect(tokens.verifyAccess).toHaveBeenCalledWith('access.jwt');
    expect(info.extra).toMatchObject({ org: 'o1', role: 'admin' });
  });

  it('exchangeRefreshToken rotates: new refresh token is issued+saved, the used one is revoked', async () => {
    const { provider, store } = makeProvider();
    await store.saveRefreshToken('old-refresh.jwt', 'u1');
    const out = await provider.exchangeRefreshToken({ client_id: 'c1' } as any, 'old-refresh.jwt');
    expect(out).toMatchObject({ access_token: 'access.jwt', refresh_token: 'new-refresh.jwt' });
    expect(store.saveRefreshToken).toHaveBeenCalledWith('new-refresh.jwt', 'u1');
    expect(store.revokeRefreshToken).toHaveBeenCalledWith('old-refresh.jwt');
  });

  it('exchangeRefreshToken rejects a token that is not typ=refresh', async () => {
    const { provider, store, tokens } = makeProvider();
    await store.saveRefreshToken('access.jwt', 'u1'); // even if somehow stored
    tokens.verifyRefresh.mockRejectedValueOnce(new Error('wrong typ'));
    await expect(provider.exchangeRefreshToken({ client_id: 'c1' } as any, 'access.jwt')).rejects.toThrow();
  });

  it('revokeToken deletes the refresh token from the store (no-op for unknown tokens)', async () => {
    const { provider, store } = makeProvider();
    await provider.revokeToken({ client_id: 'c1' } as any, { token: 'some-refresh.jwt' });
    expect(store.revokeRefreshToken).toHaveBeenCalledWith('some-refresh.jwt');
  });
});
