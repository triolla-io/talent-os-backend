import { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import { PostmarkPayloadDto } from './dto/postmark-payload.dto';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let mockPrisma: any;
  let mockQueue: any;
  let mockConfigService: Partial<ConfigService>;

  const tenantId = '00000000-0000-0000-0000-000000000001';

  const basePayload: PostmarkPayloadDto = {
    MessageID: 'msg-abc-123',
    From: 'candidate@example.com',
    Subject: 'My Application',
    Date: '2026-03-22T12:00:00Z',
    Attachments: [],
  };

  beforeEach(() => {
    mockPrisma = {
      emailIntakeLog: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(tenantId),
    };

    service = new WebhooksService(
      mockPrisma,
      mockQueue,
      mockConfigService as ConfigService,
    );
  });

  describe('inserts intake_log before enqueue on first receipt', () => {
    it('calls prisma.create before queue.add', async () => {
      mockPrisma.emailIntakeLog.findUnique.mockResolvedValue(null);
      mockPrisma.emailIntakeLog.create.mockResolvedValue({ id: 'log-1' });

      const createOrder: string[] = [];
      mockPrisma.emailIntakeLog.create.mockImplementation(async () => {
        createOrder.push('create');
        return { id: 'log-1' };
      });
      mockQueue.add.mockImplementation(async () => {
        createOrder.push('enqueue');
        return {};
      });

      await service.enqueue(basePayload);

      expect(createOrder).toEqual(['create', 'enqueue']);
    });
  });

  describe('idempotent on duplicate messageId with status=completed', () => {
    it('returns { status: "queued" } without re-enqueue', async () => {
      mockPrisma.emailIntakeLog.findUnique.mockResolvedValue({
        id: 'log-1',
        processingStatus: 'completed',
      });

      const result = await service.enqueue(basePayload);

      expect(result).toEqual({ status: 'queued' });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('re-enqueues when existing messageId has status=pending', () => {
    it('calls queue.add when status is pending', async () => {
      mockPrisma.emailIntakeLog.findUnique.mockResolvedValue({
        id: 'log-1',
        processingStatus: 'pending',
      });

      await service.enqueue(basePayload);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('enqueues with correct retry config', () => {
    it('calls queue.add with attempts=3, backoff type=exponential, delay=5000', async () => {
      mockPrisma.emailIntakeLog.findUnique.mockResolvedValue(null);
      mockPrisma.emailIntakeLog.create.mockResolvedValue({ id: 'log-1' });

      await service.enqueue(basePayload);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'ingest-email',
        expect.anything(),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });
  });

  describe('strips attachment blobs, keeps metadata', () => {
    it('rawPayload stored without Content but with Name, ContentType, ContentLength', async () => {
      mockPrisma.emailIntakeLog.findUnique.mockResolvedValue(null);
      mockPrisma.emailIntakeLog.create.mockResolvedValue({ id: 'log-1' });

      const payloadWithAttachment: PostmarkPayloadDto = {
        ...basePayload,
        Attachments: [
          {
            Name: 'cv.pdf',
            Content: 'base64data',
            ContentType: 'application/pdf',
            ContentLength: 12345,
          },
        ],
      };

      await service.enqueue(payloadWithAttachment);

      const createCall = mockPrisma.emailIntakeLog.create.mock.calls[0][0];
      const storedAttachment = (createCall.data.rawPayload as any).Attachments[0];

      expect(storedAttachment.Name).toBe('cv.pdf');
      expect(storedAttachment.ContentType).toBe('application/pdf');
      expect(storedAttachment.ContentLength).toBe(12345);
      expect(storedAttachment.Content).toBeUndefined();
    });
  });

  describe('returns 5xx error when enqueue fails after intake_log insert (D-01)', () => {
    it('throws when queue.add fails after prisma.create', async () => {
      mockPrisma.emailIntakeLog.findUnique.mockResolvedValue(null);
      mockPrisma.emailIntakeLog.create.mockResolvedValue({ id: 'log-1' });
      mockQueue.add.mockRejectedValue(new Error('Redis connection failed'));

      await expect(service.enqueue(basePayload)).rejects.toThrow();
    });
  });
});
