import { HttpException, HttpStatus } from '@nestjs/common';
import { JiraGatewayService } from './jira-gateway.service';
import type { IssueDraft } from './dto/ai-output.dto';

const BASE_URL = 'https://example.atlassian.net';
const EMAIL = 'user@example.com';
const TOKEN = 'secret-token';
const PROJECT_KEY = 'TP';
const EXPECTED_AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

function makeService(overrides: Record<string, string> = {}) {
  const config = {
    get: jest.fn((key: string) => {
      const vals: Record<string, string> = {
        JIRA_BASE_URL: BASE_URL,
        JIRA_EMAIL: EMAIL,
        JIRA_API_TOKEN: TOKEN,
        JIRA_PROJECT_KEY: PROJECT_KEY,
        ...overrides,
      };
      return vals[key];
    }),
  };
  return new JiraGatewayService(config as any);
}

const mockIssue: IssueDraft = {
  issueType: 'Story',
  summary: 'Test story',
  description: 'A description',
  acceptanceCriteria: ['AC1'],
};

describe('JiraGatewayService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('uses correct Basic auth header', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [] }) } as any);
    const svc = makeService();
    await svc.readBoard();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: EXPECTED_AUTH }) }),
    );
  });

  it('builds JQL with configured project key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [] }) } as any);
    const svc = makeService();
    await svc.readBoard();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.jql).toContain(PROJECT_KEY);
    expect(body.jql).toContain('statusCategory != "Done"');
  });

  it('create payload includes parent only when suggestedEpicKey is set', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ key: 'TP-1' }) } as any);
    const svc = makeService();
    await svc.createIssue({ ...mockIssue, suggestedEpicKey: 'TP-0' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.fields.parent).toEqual({ key: 'TP-0' });
  });

  it('create payload omits parent when suggestedEpicKey is absent', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ key: 'TP-1' }) } as any);
    const svc = makeService();
    await svc.createIssue(mockIssue);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.fields.parent).toBeUndefined();
  });

  it('update payload omits project field', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    const svc = makeService();
    await svc.updateIssue('TP-5', mockIssue);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.fields.project).toBeUndefined();
  });

  it('throws a 502 HttpException with JIRA_ERROR envelope on non-2xx response', async () => {
    expect.assertions(3);
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' } as any);
    const svc = makeService();
    try {
      await svc.readBoard();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((e as HttpException).getResponse()).toEqual({
        error: { code: 'JIRA_ERROR', message: expect.stringContaining('401') },
      });
    }
  });
});
