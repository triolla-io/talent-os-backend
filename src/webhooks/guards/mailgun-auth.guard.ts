import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MailgunAuthGuard implements CanActivate {
  constructor(@Optional() private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      body: { timestamp?: string; token?: string; signature?: string };
    }>();
    const { timestamp, token, signature } = request.body ?? {};

    if (!timestamp || !token || !signature) {
      throw new UnauthorizedException('Missing Mailgun auth fields');
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      throw new UnauthorizedException('Webhook timestamp expired');
    }

    const signingKey = this.configService.get<string>('MAILGUN_WEBHOOK_SIGNING_KEY') ?? '';
    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(timestamp + token)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid Mailgun webhook signature');
    }

    return true;
  }
}
