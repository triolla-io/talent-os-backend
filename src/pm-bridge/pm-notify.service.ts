import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../auth/email.service';
import { PmHoldTokenService } from './pm-hold-token.service';

@Injectable()
export class PmNotifyService {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly tokens: PmHoldTokenService,
  ) {}

  async notifyHeld(input: { holdId: string; rawText: string; goal: string; reasonPlain: string }): Promise<void> {
    const to = this.config.get<string>('PM_HOLD_NOTIFY_EMAIL') ?? 'daniel.s@triolla.io';
    const base = (
      this.config.get<string>('API_PUBLIC_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');

    const token = await this.tokens.sign(input.holdId);
    const approveUrl = `${base}/api/pm-bridge/holds/${input.holdId}/approve?t=${token}`;
    const rejectUrl = `${base}/api/pm-bridge/holds/${input.holdId}/reject?t=${token}`;

    const body = [
      'A PM tried to file work that clashes with existing tickets or product decisions.',
      '',
      'What the PM asked for:',
      input.rawText,
      '',
      `Goal: ${input.goal}`,
      '',
      `Why it was held: ${input.reasonPlain}`,
      '',
      `Approve (build it in Jira): ${approveUrl}`,
      '',
      `Reject (discard it): ${rejectUrl}`,
    ].join('\n');

    await this.email.sendText(to, `[PM Bridge] Review needed: ${input.goal}`, body);
  }
}
