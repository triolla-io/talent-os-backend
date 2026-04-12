import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { ConfigService } from '@nestjs/config';

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined), getOrThrow: jest.fn() } },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
  });

  it.todo('logs to console when RESEND_API_KEY is absent in dev (D-12)');
  it.todo('calls resend.emails.send when RESEND_API_KEY is set');
  it.todo('sendInvitationEmail includes invite link with token');
  it.todo('sendMagicLinkEmail includes magic link URL with token');
  it.todo('sendUseGoogleEmail tells user to use Google login');
});
