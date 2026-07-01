import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import { ConfigService } from '@nestjs/config';
import rateLimit from 'express-rate-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { McpOAuthProvider } from './mcp-oauth.provider';

export async function mountMcpRoutes(
  app: NestExpressApplication,
  expressApp: Express,
  buildServer: () => McpServer,
): Promise<void> {
  const config = app.get(ConfigService);
  const provider = app.get(McpOAuthProvider);
  const publicUrl = new URL(config.getOrThrow<string>('MCP_PUBLIC_URL'));

  // Rate limits (defense in depth — a Cloudflare WAF rate rule should also sit at the edge).
  // Auth endpoints are the abuse-sensitive ones (open DCR, token/code exchange).
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const mcpLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
  expressApp.use(['/register', '/token', '/authorize'], authLimiter);

  // OAuth authorization-server + protected-resource metadata + endpoints.
  expressApp.use(
    mcpAuthRouter({
      provider,
      issuerUrl: publicUrl,
      baseUrl: publicUrl,
      resourceServerUrl: new URL('/mcp', publicUrl),
      scopesSupported: ['mcp'],
      resourceName: 'Talent OS',
    }),
  );

  const bearer = requireBearerAuth({
    verifier: { verifyAccessToken: (t: string) => provider.verifyAccessToken(t) },
    requiredScopes: ['mcp'],
    resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', publicUrl).toString(),
  });

  // Host allowlist for DNS-rebinding protection (SDK ≥1.24). Defaults to the MCP_PUBLIC_URL
  // host; MCP_ALLOWED_HOSTS can add the value a reverse proxy forwards if it differs (if /mcp
  // starts returning 403 after deploy, add the proxied Host here rather than disabling this).
  const allowedHosts = [
    publicUrl.host,
    ...(config.get<string>('MCP_ALLOWED_HOSTS') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  ];

  // Streamable HTTP, stateless: a fresh server+transport per request.
  expressApp.post('/mcp', mcpLimiter, bearer, async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, (req as unknown as { body: unknown }).body);
  });

  // Stateless mode: GET/DELETE are not supported.
  expressApp.get('/mcp', (_req, res) => res.status(405).json({ error: 'method_not_allowed' }));
  expressApp.delete('/mcp', (_req, res) => res.status(405).json({ error: 'method_not_allowed' }));
}
