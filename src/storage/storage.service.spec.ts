import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { PostmarkAttachmentDto } from '../webhooks/dto/postmark-payload.dto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
  };
});

const mockConfigService = {
  get: jest.fn((key: string) => {
    const vars: Record<string, string> = {
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_BUCKET_NAME: 'test-bucket',
    };
    return vars[key];
  }),
};

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    mockS3Send.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<StorageService>(StorageService);
  });

  const pdfAttachment = (): PostmarkAttachmentDto => ({
    Name: 'cv.pdf',
    ContentType: 'application/pdf',
    ContentLength: 150000,
    Content: Buffer.from('PDF data').toString('base64'),
  });

  const docxAttachment = (): PostmarkAttachmentDto => ({
    Name: 'cv.docx',
    ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ContentLength: 100000,
    Content: Buffer.from('DOCX data').toString('base64'),
  });

  const pngAttachment = (): PostmarkAttachmentDto => ({
    Name: 'signature.png',
    ContentType: 'image/png',
    ContentLength: 5000,
    Content: Buffer.from('PNG data').toString('base64'),
  });

  it('STOR-01: uploads largest PDF to R2 with correct key format', async () => {
    mockS3Send.mockResolvedValue({});

    const key = await service.upload(
      [pngAttachment(), pdfAttachment()],
      'tenant-123',
      'msg-456',
    );

    expect(key).toBe('cvs/tenant-123/msg-456.pdf');
    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: 'cvs/tenant-123/msg-456.pdf',
          Bucket: 'test-bucket',
          ContentType: 'application/pdf',
        }),
      }),
    );
  });

  it('STOR-01: returns null if no PDF/DOCX attachment found (D-02)', async () => {
    const key = await service.upload([pngAttachment()], 'tenant-123', 'msg-456');

    expect(key).toBeNull();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('STOR-02: does NOT return presigned URL, only object key', async () => {
    mockS3Send.mockResolvedValue({});

    const key = await service.upload([pdfAttachment()], 'tenant-123', 'msg-456');

    expect(key).not.toContain('https://');
    expect(key).not.toContain('r2.cloudflarestorage.com');
    expect(key).toMatch(/^cvs\/[^/]+\/[^/]+\.(pdf|docx)$/);
  });

  it('D-11: sets explicit ContentType on PutObjectCommand', async () => {
    mockS3Send.mockResolvedValue({});

    await service.upload([docxAttachment()], 'tenant-123', 'msg-456');

    expect(mockS3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          ContentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      }),
    );
  });

  it('D-07: propagates R2 errors to caller (no catch)', async () => {
    mockS3Send.mockRejectedValue(new Error('R2 temporarily unavailable'));

    await expect(
      service.upload([pdfAttachment()], 'tenant-123', 'msg-456'),
    ).rejects.toThrow('R2 temporarily unavailable');
  });
});
