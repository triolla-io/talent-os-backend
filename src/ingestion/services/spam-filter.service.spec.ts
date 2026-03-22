import { PostmarkPayloadDto } from '../../webhooks/dto/postmark-payload.dto';
import { SpamFilterService } from './spam-filter.service';

export function mockPostmarkPayload(
  overrides: Partial<PostmarkPayloadDto> = {},
): PostmarkPayloadDto {
  return {
    MessageID: 'test-message-id',
    From: 'test@example.com',
    Subject: 'Test Subject',
    TextBody: 'Hello world, this is a test email with enough text to not be spam.',
    Date: new Date().toISOString(),
    Attachments: [],
    ...overrides,
  };
}

export function mockBase64Pdf(): string {
  // Minimal valid base64 string — not a real PDF; used for testing Content field presence
  return Buffer.from('%PDF-1.4 fake pdf content for testing').toString('base64');
}

export function mockBase64Docx(): string {
  return Buffer.from('PK fake docx content for testing').toString('base64');
}

describe('SpamFilterService', () => {
  let service: SpamFilterService;

  beforeEach(() => {
    service = {
      check: jest.fn(),
    } as unknown as SpamFilterService;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // PROC-02: Hard reject — no attachment AND body < 100 chars
  it.todo('no attachment and short body');

  // PROC-02: Not spam when attachment exists even with short body
  it.todo('attachment present');

  // PROC-03: Spam when keyword in subject, no attachment
  it.todo('keyword subject no attachment');

  // PROC-03: Suspicious when keyword in body, attachment present
  it.todo('keyword body with attachment');

  // PROC-03: Case-insensitive keyword matching
  it.todo('keyword variations');
});
