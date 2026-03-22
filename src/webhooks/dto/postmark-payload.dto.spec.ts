import { PostmarkPayloadSchema, PostmarkAttachmentSchema } from './postmark-payload.dto';

describe('PostmarkPayloadSchema', () => {
  const validPayload = {
    MessageID: 'abc-123',
    From: 'candidate@example.com',
    Subject: 'My CV',
    Date: '2026-03-22T12:00:00Z',
  };

  it('rejects payload missing MessageID → z.ZodError thrown', () => {
    const { MessageID: _, ...withoutId } = validPayload;
    expect(() => PostmarkPayloadSchema.parse(withoutId)).toThrow();
  });

  it('rejects payload with non-email string in From field → z.ZodError thrown', () => {
    expect(() =>
      PostmarkPayloadSchema.parse({ ...validPayload, From: 'not-an-email' }),
    ).toThrow();
  });

  it('accepts payload with no Attachments field → Attachments defaults to []', () => {
    const result = PostmarkPayloadSchema.parse(validPayload);
    expect(result.Attachments).toEqual([]);
  });

  it('accepts payload with attachment that has no Content field → valid', () => {
    const result = PostmarkPayloadSchema.parse({
      ...validPayload,
      Attachments: [
        { Name: 'cv.pdf', ContentType: 'application/pdf', ContentLength: 12345 },
      ],
    });
    expect(result.Attachments[0].Content).toBeUndefined();
  });

  it('accepts attachment with Content, Name, ContentType, ContentLength → valid', () => {
    const result = PostmarkPayloadSchema.parse({
      ...validPayload,
      Attachments: [
        {
          Name: 'cv.pdf',
          Content: 'base64encodeddata',
          ContentType: 'application/pdf',
          ContentLength: 12345,
        },
      ],
    });
    expect(result.Attachments[0].Content).toBe('base64encodeddata');
    expect(result.Attachments[0].Name).toBe('cv.pdf');
  });

  it('accepts a fully valid payload and infers correct types', () => {
    const result = PostmarkPayloadSchema.parse({
      ...validPayload,
      TextBody: 'Hello',
      HtmlBody: '<p>Hello</p>',
    });
    expect(result.MessageID).toBe('abc-123');
    expect(result.From).toBe('candidate@example.com');
  });
});

describe('PostmarkAttachmentSchema', () => {
  it('requires Name, ContentType, ContentLength', () => {
    expect(() =>
      PostmarkAttachmentSchema.parse({ ContentType: 'application/pdf', ContentLength: 100 }),
    ).toThrow();
  });

  it('Content field is optional', () => {
    const result = PostmarkAttachmentSchema.parse({
      Name: 'file.pdf',
      ContentType: 'application/pdf',
      ContentLength: 100,
    });
    expect(result.Content).toBeUndefined();
  });
});
