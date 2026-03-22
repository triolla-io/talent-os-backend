import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PostmarkAttachmentDto } from '../webhooks/dto/postmark-payload.dto';

const CV_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;

  constructor(private readonly config: ConfigService) {
    this.s3Client = new S3Client({
      region: 'auto', // R2 uses 'auto' region (not a standard AWS region)
      credentials: {
        accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY')!,
      },
      endpoint: `https://${this.config.get<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    });
  }

  // D-01, D-02, D-04, D-06, D-10, D-11
  async upload(
    attachments: PostmarkAttachmentDto[],
    tenantId: string,
    messageId: string,
  ): Promise<string | null> {
    // D-01: Select largest PDF/DOCX; filters out signature images, logos, etc.
    const selected = this.selectLargestCvAttachment(attachments);
    if (!selected) {
      // D-02: No qualifying file — return null, job continues
      return null;
    }

    const extension = this.getExtension(selected.ContentType);
    // D-10: Key includes correct extension based on ContentType
    const key = `cvs/${tenantId}/${messageId}${extension}`;
    const buffer = Buffer.from(selected.Content!, 'base64');

    const command = new PutObjectCommand({
      Bucket: this.config.get<string>('R2_BUCKET_NAME')!,
      Key: key,
      Body: buffer,
      ContentType: selected.ContentType, // D-11: Explicit ContentType for browser rendering
    });

    // D-07: Transient R2 errors propagate to BullMQ for automatic retry.
    // Do NOT catch here — retrying the full job is correct for network failures.
    await this.s3Client.send(command);

    this.logger.log(`Uploaded ${key} to R2 (${buffer.length} bytes)`);
    // D-04: Return object key only — NOT a presigned URL
    return key;
  }

  private selectLargestCvAttachment(
    attachments: PostmarkAttachmentDto[],
  ): PostmarkAttachmentDto | null {
    // D-01: Only PDF/DOCX; picks the one with the largest ContentLength
    const cvFiles = attachments.filter((att) =>
      (CV_MIME_TYPES as readonly string[]).includes(att.ContentType),
    );
    if (cvFiles.length === 0) return null;
    return cvFiles.reduce((largest, current) =>
      (current.ContentLength ?? 0) > (largest.ContentLength ?? 0) ? current : largest,
    );
  }

  private getExtension(contentType: string): string {
    const extensions: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    return extensions[contentType] ?? '.bin';
  }
}
