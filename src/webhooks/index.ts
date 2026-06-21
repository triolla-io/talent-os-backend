// Public API for the webhooks module. Import shared email payload types from
// here (`../webhooks`) rather than reaching into `./dto/*` internals.
export type { EmailAttachmentDto, EmailPayloadDto } from './dto/mailgun-payload.dto';
