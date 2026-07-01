jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ set: jest.fn(), get: jest.fn(), getdel: jest.fn(), del: jest.fn() })),
);

// MUST be imported before ./mcp.module — sets env that ConfigModule.forRoot validates at import time.
import './mcp-test-env';
import { Test } from '@nestjs/testing';
import { McpModule } from './mcp.module';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { McpTokenService } from './mcp-token.service';

describe('McpModule', () => {
  it('compiles and provides the OAuth provider + token service', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [McpModule] }).compile();
    expect(moduleRef.get(McpOAuthProvider, { strict: false })).toBeInstanceOf(McpOAuthProvider);
    expect(moduleRef.get(McpTokenService, { strict: false })).toBeInstanceOf(McpTokenService);
    await moduleRef.close();
  });
});
