import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let mockWebhooksService: Partial<WebhooksService>;

  const VALID_HEADERS = JSON.stringify([['Message-Id', '<msg-xyz-456@example.com>']]);

  function buildMockReq(overrides: Record<string, unknown> = {}, files: unknown[] = []) {
    return {
      body: {
        timestamp: '1748000000',
        token: 'a'.repeat(50),
        signature: 'b'.repeat(64),
        from: 'applicant@example.com',
        subject: 'Applying for Engineer role',
        'message-headers': VALID_HEADERS,
        ...overrides,
      },
      files,
    };
  }

  beforeEach(async () => {
    mockWebhooksService = {
      enqueue: jest.fn().mockResolvedValue({ status: 'queued' }),
      checkHealth: jest.fn().mockResolvedValue({ status: 'ok', db: 'ok', redis: 'ok' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: mockWebhooksService }],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  describe('POST /webhooks/email', () => {
    it('normalizes Mailgun payload and calls enqueue with EmailPayloadDto', async () => {
      const result = await controller.ingestEmail(buildMockReq() as any);
      expect(result).toEqual({ status: 'queued' });
      expect(mockWebhooksService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          MessageID: 'msg-xyz-456@example.com',
          From: 'applicant@example.com',
          Subject: 'Applying for Engineer role',
        }),
      );
    });

    it('throws BadRequestException when timestamp is missing', async () => {
      const req = buildMockReq({ timestamp: undefined });
      await expect(controller.ingestEmail(req as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when from is missing', async () => {
      const req = buildMockReq({ from: undefined });
      await expect(controller.ingestEmail(req as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when message-headers is invalid JSON', async () => {
      const req = buildMockReq({ 'message-headers': 'not-json' });
      await expect(controller.ingestEmail(req as any)).rejects.toThrow(BadRequestException);
    });

    it('maps uploaded files to base64 attachments and passes them to enqueue', async () => {
      const fakeFile = {
        originalname: 'cv.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        buffer: Buffer.from('pdf-content'),
      };
      await controller.ingestEmail(buildMockReq({}, [fakeFile]) as any);
      const called = (mockWebhooksService.enqueue as jest.Mock).mock.calls[0][0];
      expect(called.Attachments).toHaveLength(1);
      expect(called.Attachments[0].Name).toBe('cv.pdf');
      expect(called.Attachments[0].Content).toBe(Buffer.from('pdf-content').toString('base64'));
    });
  });

  describe('GET /health', () => {
    it('returns { status: "ok", db: "ok", redis: "ok" }', async () => {
      const result = await controller.health();
      expect(result).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
      expect(mockWebhooksService.checkHealth).toHaveBeenCalled();
    });
  });
});
