import { HttpException, HttpStatus } from '@nestjs/common';
import { JiraGatewayService } from './jira-gateway.service';

const BASE_URL = 'https://example.atlassian.net';
const EMAIL = 'user@example.com';
const TOKEN = 'secret-token';
const PROJECT_KEY = 'TP';
const EXPECTED_AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

function makeService(overrides: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn((key: string) => {
      const vals: Record<string, string | undefined> = {
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

function okJson(body: unknown) {
  return { ok: true, json: async () => body, text: async () => '' } as any;
}

describe('JiraGatewayService.readBoard', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('uses correct Basic auth header', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [] }) } as any);
    await makeService().readBoard();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: EXPECTED_AUTH }) }),
    );
  });

  it('builds JQL with configured project key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [] }) } as any);
    await makeService().readBoard();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.jql).toContain(PROJECT_KEY);
    expect(body.jql).toContain('statusCategory != "Done"');
  });

  it('throws a 502 HttpException with JIRA_ERROR envelope on non-2xx response', async () => {
    expect.assertions(3);
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' } as any);
    try {
      await makeService().readBoard();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((e as HttpException).getResponse()).toEqual({
        error: { code: 'JIRA_ERROR', message: expect.stringContaining('401') },
      });
    }
  });
});

afterEach(() => jest.restoreAllMocks());

describe('JiraGatewayService.createIssueTree', () => {
  it('creates Epic → child → subtask, assigns each, and links parents', async () => {
    const gw = makeService({ JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID: 'acc-daniel' });
    const keys = ['TO-10', 'TO-11', 'TO-12'];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(okJson({ key: keys.shift() })));

    const result = await gw.createIssueTree({
      issueType: 'Epic', summary: 'Referral program', description: 'd', acceptanceCriteria: [], subtasks: [],
      children: [{ issueType: 'Story', summary: 'Invite flow', description: 'd', acceptanceCriteria: ['works'], subtasks: [{ summary: 'API', description: 'd' }] }],
    });

    expect(result.keys).toEqual(['TO-10', 'TO-11', 'TO-12']);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as any).body));
    // every issue assigned to Daniel
    expect(bodies.every((b) => b.fields.assignee?.accountId === 'acc-daniel')).toBe(true);
    // child parented to epic, subtask parented to child
    expect(bodies[1].fields.parent).toEqual({ key: 'TO-10' });
    expect(bodies[2].fields.parent).toEqual({ key: 'TO-11' });
    expect(bodies[2].fields.issuetype).toEqual({ name: 'Sub-task' });
  });
});

describe('JiraGatewayService.addComment', () => {
  it('POSTs an ADF comment body', async () => {
    const gw = makeService({ JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID: 'acc' });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(okJson({}));
    await gw.addComment('TO-5', 'PM follow-up: make it faster');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/TO-5/comment');
    expect(JSON.parse((opts as any).body).body.type).toBe('doc');
  });
});
