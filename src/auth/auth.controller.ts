import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import * as express from 'express';
import { SessionGuard } from './session.guard';
import { AuthService } from './auth.service';
import { JwtPayload } from './jwt.service';

const SESSION_COOKIE = 'talent_os_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms (D-01)

function setSessionCookie(res: express.Response, token: string): void {
  // D-02: httpOnly, sameSite:lax, path:/, maxAge:7d, secure in production (T-19-07)
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // GET /auth/me — D-17: requires SessionGuard (T-19-08: unauthorized access mitigated)
  @Get('me')
  @UseGuards(SessionGuard)
  async getMe(@Req() req: Request) {
    const session = req.session as JwtPayload;
    return this.authService.getMe(session);
  }

  // POST /auth/google/verify — D-17: no SessionGuard (public endpoint)
  @Post('google/verify')
  @HttpCode(200)
  async googleVerify(
    @Body('access_token') accessToken: string,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    if (!accessToken) {
      return { error: { code: 'VALIDATION_ERROR', message: 'access_token is required', details: {} } };
    }
    const { meResponse, sessionToken } = await this.authService.googleVerify(accessToken);
    setSessionCookie(res, sessionToken);
    return meResponse;
  }

  // POST /auth/logout — D-04: clear cookie, returns { success: true }
  // D-17: SessionGuard NOT required — clearing cookie always succeeds regardless of session state
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: express.Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  }
}
