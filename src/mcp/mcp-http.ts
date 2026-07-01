import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import { ConfigService } from '@nestjs/config';
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

  // Streamable HTTP, stateless: a fresh server+transport per request.
  expressApp.post('/mcp', bearer, async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
