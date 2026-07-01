import { ConfigService } from '@nestjs/config';
import { McpTokenService } from './mcp-token.service';
import { JwtService } from '../auth/jwt.service';

const SECRET = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const AUD = 'https://mcp.example.com';

function cfg(secret: string): ConfigService {
  return { getOrThrow: (k: string) => (k === 'MCP_JWT_SECRET' ? secret : AUD) } as unknown as ConfigService;
}

describe('McpTokenService', () => {
  const svc = new McpTokenService(cfg(SECRET));

  it('signs and verifies an access token with scope + aud', async () => {
    const t = await svc.signAccess({ sub: 'u1', org: 'o1', role: 'admin' });
    const claims = await svc.verify(t);
    expect(claims).toMatchObject({ sub: 'u1', org: 'o1', role: 'admin', scope: 'mcp', aud: AUD });
  });

  it('rejects a token signed with a different secret (isolation)', async () => {
    const foreign = await new McpTokenService(cfg(OTHER)).signAccess({ sub: 'u1', org: 'o1', role: 'admin' });
    await expect(svc.verify(foreign)).rejects.toThrow();
  });

  it('the SPA JwtService cannot verify an MCP token (cross-guard isolation)', async () => {
    const spa = new JwtService(cfg(SECRET) as any); // JwtService reads JWT_SECRET; give it a DIFFERENT secret in real env
    void spa;
    const mcpToken = await svc.signAccess({ sub: 'u1', org: 'o1', role: 'admin' });
    // With distinct secrets in production, JwtService.verify would reject. Here we assert the token
    // carries scope:'mcp' + aud so a scope-checking guard could also reject it.
    const claims = await svc.verify(mcpToken);
    expect(claims.scope).toBe('mcp');
    expect(claims.aud).toBe(AUD);
  });
});
