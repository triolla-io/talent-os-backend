import { z } from 'zod';

// ─── Raw Mailgun multipart body (fields only — files are on req.files) ────────

export const MailgunRawBodySchema = z.object({
  timestamp: z.string().regex(/^\d+$/, 'timestamp must be a Unix epoch number'),
  token: z.string().min(1),
  signature: z.string().min(1),
  from: z.string().min(1),
  subject: z.string().default(''),
  'body-plain': z.string().optional(),
  'body-html': z.string().optional(),
  // stripped-text: Mailgun removes reply chains and signatures automatically.
  // Preferred over body-plain for AI extraction — less noise, fewer tokens.
  'stripped-text': z.string().optional(),
  'message-headers': z.string().refine(
    (val) => {
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'message-headers must be valid JSON' },
  ),
  recipient: z.string().optional(),
});

export type MailgunRawBodyDto = z.infer<typeof MailgunRawBodySchema>;

// ─── Internal normalized email payload ───────────────────────────────────────
// PascalCase field names used throughout the storage service, ingestion
// pipeline, and worker.

export const EmailAttachmentSchema = z.object({
  Name: z.string(),
  Content: z.string().optional(),
  ContentType: z.string(),
  ContentLength: z.number(),
  ContentID: z.string().optional(),
});

export const EmailPayloadSchema = z.object({
  MessageID: z.string().min(1),
  From: z.string().email(),
  Subject: z.string().default(''),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  Date: z.string(),
  Attachments: z.array(EmailAttachmentSchema).default([]),
});

export type EmailAttachmentDto = z.infer<typeof EmailAttachmentSchema>;
export type EmailPayloadDto = z.infer<typeof EmailPayloadSchema>;

// ─── Mapping: Mailgun multipart → internal EmailPayloadDto ───────────────────

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

export function parseMailgunPayload(body: MailgunRawBodyDto, files: Express.Multer.File[]): EmailPayloadDto {
  const headers = JSON.parse(body['message-headers']) as [string, string][];
  const msgIdEntry = headers.find(([name]) => name.toLowerCase() === 'message-id');
  // Strip RFC-2822 angle brackets so the value is safe as an R2 key path segment.
  const rawMessageId = msgIdEntry?.[1] ?? body.token;
  const messageId = rawMessageId.replace(/^<|>$/g, '').trim();

  return {
    MessageID: messageId,
    From: extractEmail(body.from),
    Subject: body.subject ?? '',
    // Prefer stripped-text: Mailgun removes reply chains + signatures automatically,
    // reducing noise for the AI extraction agent and lowering token usage.
    // Falls back to body-plain when stripped-text is absent (e.g. new plain-text emails).
    TextBody: body['stripped-text'] || body['body-plain'],
    HtmlBody: body['body-html'],
    Date: new Date(parseInt(body.timestamp, 10) * 1000).toISOString(),
    // NOTE: Storing base64 Content here is required for backward compatibility with
    // the ingestion worker's AttachmentExtractorService, which reads att.Content
    // from the payload.json downloaded from R2. Refactoring the worker to read the
    // binary directly from cvFileKey would eliminate the redundant R2 storage
    // (base64 in payload.json + binary in cv.pdf), but is out of scope here.
    Attachments: files.map((file) => ({
      Name: file.originalname,
      Content: file.buffer.toString('base64'),
      ContentType: file.mimetype,
      ContentLength: file.size,
    })),
  };
}
