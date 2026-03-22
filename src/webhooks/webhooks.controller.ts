import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PostmarkPayloadDto, PostmarkPayloadSchema } from './dto/postmark-payload.dto';
import { PostmarkAuthGuard } from './guards/postmark-auth.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PostmarkAuthGuard)
  async ingestEmail(@Body() rawBody: unknown): Promise<{ status: string }> {
    // Parse and validate payload with Zod
    const payload = PostmarkPayloadSchema.parse(rawBody) as PostmarkPayloadDto;
    return this.webhooksService.enqueue(payload);
  }

  @Get('health')
  async health(): Promise<{ status: string; db: string; redis: string }> {
    return this.webhooksService.checkHealth();
  }
}
