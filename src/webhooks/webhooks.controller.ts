import { BadRequestException, Controller, Post, Get, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { MailgunRawBodySchema, parseMailgunPayload } from './dto/mailgun-payload.dto';
import { MailgunAuthGuard } from './guards/mailgun-auth.guard';
import { Public } from '../common/decorators/public.decorator';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // @Public(): no session — inbound Mailgun webhook is authenticated by HMAC signature
  // (MailgunAuthGuard), not a session cookie. Marks this route to bypass the global SessionGuard;
  // MailgunAuthGuard + ThrottlerGuard still run.
  @Public()
  @UseGuards(MailgunAuthGuard, ThrottlerGuard)
  @Post('email')
  @HttpCode(HttpStatus.OK)
  async ingestEmail(@Req() req: Request): Promise<{ status: string }> {
    const result = MailgunRawBodySchema.safeParse(req.body);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid Mailgun payload',
          details: result.error.flatten().fieldErrors,
        },
      });
    }
    const normalized = parseMailgunPayload(result.data, (req.files ?? []) as Express.Multer.File[]);
    return this.webhooksService.enqueue(normalized);
  }

  // Public service-health probe — no session required.
  @Public()
  @Get('health')
  async health(): Promise<{ status: string; db: string; redis: string }> {
    return this.webhooksService.checkHealth();
  }
}
