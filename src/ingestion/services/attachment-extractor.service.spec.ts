import { AttachmentExtractorService } from './attachment-extractor.service';
import {
  mockBase64Pdf,
  mockBase64Docx,
  mockPostmarkPayload,
} from './spam-filter.service.spec';

describe('AttachmentExtractorService', () => {
  let service: AttachmentExtractorService;

  beforeEach(() => {
    service = {
      extract: jest.fn(),
    } as unknown as AttachmentExtractorService;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // PROC-04: Single PDF attachment returns extracted text with demarcation header
  it.todo('PDF extraction');

  // PROC-05: Single DOCX attachment returns extracted text with demarcation header
  it.todo('DOCX extraction');

  // PROC-04/05: Unsupported ContentType is skipped, no error thrown
  it.todo('unsupported type');

  // PROC-04/05: Corrupted base64 content causes warning log, not crash; remaining attachments still processed
  it.todo('corrupted PDF');

  // PROC-04/05: PDF + DOCX in same email both parsed and merged into single string with demarcation headers
  it.todo('multiple attachments');
});
