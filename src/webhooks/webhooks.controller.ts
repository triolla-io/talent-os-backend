import { BadRequestException, Controller, Post, Get, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { MailgunRawBodySchema, parseMailgunPayload } from './dto/mailgun-payload.dto';
import { MailgunAuthGuard } from './guards/mailgun-auth.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

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

  @Get('health')
  async health(): Promise<{ status: string; db: string; redis: string }> {
    return this.webhooksService.checkHealth();
  }
}
