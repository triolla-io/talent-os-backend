import { PmNotifyService } from './pm-notify.service';

function make() {
  const email = { sendText: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'PM_HOLD_NOTIFY_EMAIL') return 'daniel.s@triolla.io';
      if (key === 'API_PUBLIC_URL') return 'https://api.triolla.io';
      return undefined;
    }),
  };
  const tokens = { sign: jest.fn().mockResolvedValue('signed-token') };
  return { svc: new PmNotifyService(email as any, config as any, tokens as any), email, tokens };
}

describe('PmNotifyService.notifyHeld', () => {
  it('emails the notify address with approve + reject links carrying the token', async () => {
    const { svc, email } = make();
    await svc.notifyHeld({ holdId: 'h1', rawText: 'make it pop', goal: 'Make the page pop', reasonPlain: 'breaks the layout rule' });
    expect(email.sendText).toHaveBeenCalledTimes(1);
    const [to, subject, body] = email.sendText.mock.calls[0];
    expect(to).toBe('daniel.s@triolla.io');
    expect(subject).toContain('Make the page pop');
    expect(body).toContain('https://api.triolla.io/api/pm-bridge/holds/h1/approve?t=signed-token');
    expect(body).toContain('https://api.triolla.io/api/pm-bridge/holds/h1/reject?t=signed-token');
    expect(body).toContain('breaks the layout rule');
  });
});
