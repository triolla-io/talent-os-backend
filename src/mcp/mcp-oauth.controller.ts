import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { McpOAuthProvider } from './mcp-oauth.provider';

// AuthModule registers SessionGuard as a global APP_GUARD, and McpModule imports
// AuthModule (for AuthService), so this route sits behind SessionGuard unless marked
// @Public(). No cookie/session is involved in the MCP federated-login flow.
@Public()
@UseGuards(ThrottlerGuard)
@Controller('mcp-oauth')
export class McpOAuthController {
  constructor(private readonly provider: McpOAuthProvider) {}

  @Post('complete')
  @HttpCode(200)
  async complete(@Body() body: { loginSessionId?: string; access_token?: string }) {
    if (!body?.loginSessionId || !body?.access_token) {
      return { message: 'loginSessionId and access_token are required' };
    }
    try {
      return await this.provider.completeLogin(body.loginSessionId, body.access_token);
    } catch (e) {
      return { message: e instanceof Error ? e.message : 'Sign-in failed' };
    }
  }
}
