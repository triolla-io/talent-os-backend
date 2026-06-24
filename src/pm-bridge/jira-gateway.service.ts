import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toAdf } from './adf.util';
import type { DecomposedRoot } from './dto/ai-output.dto';

export interface CondensedTicket {
  key: string;
  type: string;
  summary: string;
  status: string;
}

export interface JiraIssueResult {
  key: string;
  url: string;
}

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      issuetype: { name: string };
      summary: string;
      status: { name: string };
    };
  }>;
}

interface JiraCreateResponse {
  key: string;
}

@Injectable()
export class JiraGatewayService {
  private readonly logger = new Logger(JiraGatewayService.name);
  private readonly baseUrl: string;
  private readonly projectKey: string;
  private readonly authHeader: string;
  private readonly sprintId: number | undefined;
  // undefined = not yet resolved; null = no assignee configured/found
  private assigneeCache: { accountId: string } | null | undefined = undefined;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('JIRA_BASE_URL')!.replace(/\/$/, '');
    this.projectKey = config.get<string>('JIRA_PROJECT_KEY') ?? 'TO';
    // Never log: Jira auth header contains the API token
    const email = config.get<string>('JIRA_EMAIL')!;
    const token = config.get<string>('JIRA_API_TOKEN')!;
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.sprintId = config.get<number>('JIRA_SPRINT_ID');
  }

  async readBoard(): Promise<CondensedTicket[]> {
    const jql = `project = "${this.projectKey}" AND statusCategory != "Done" ORDER BY updated DESC`;
    const res = await fetch(`${this.baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jql,
        fields: ['issuetype', 'summary', 'status'],
        maxResults: 200,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Jira readBoard failed: ${res.status} — ${text}`);
      throw this.jiraError(`Failed to read Jira board: ${res.status}`, text);
    }

    const data = (await res.json()) as JiraSearchResponse;
    // Scale note: MVP sends all non-Done issues to Claude because the TO board is small.
    // If the board grows, pre-filter by keyword/JQL before the AI call.
    this.logger.log(`Jira board read: ${data.issues.length} non-Done issues`);

    return data.issues.map((issue) => ({
      key: issue.key,
      type: issue.fields.issuetype.name,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
    }));
  }

  async resolveAssignee(): Promise<{ accountId: string } | null> {
    if (this.assigneeCache !== undefined) return this.assigneeCache;

    const configured = this.config.get<string>('JIRA_DEFAULT_ASSIGNEE_ACCOUNT_ID');
    if (configured) {
      this.assigneeCache = { accountId: configured };
      return this.assigneeCache;
    }

    const email = this.config.get<string>('JIRA_DEFAULT_ASSIGNEE_EMAIL');
    if (!email) {
      this.logger.warn('No JIRA assignee configured — issues will be created unassigned');
      this.assigneeCache = null;
      return null;
    }

    const res = await fetch(`${this.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      this.logger.error(`Jira user search failed: ${res.status}`);
      this.assigneeCache = null;
      return null;
    }
    const users = (await res.json()) as Array<{ accountId: string }>;
    this.assigneeCache = users.length ? { accountId: users[0].accountId } : null;
    return this.assigneeCache;
  }

  private async createOne(input: {
    issueType: string;
    summary: string;
    description: string;
    acceptanceCriteria: string[];
    parentKey?: string;
  }): Promise<JiraIssueResult> {
    const assignee = await this.resolveAssignee();
    const fields: Record<string, unknown> = {
      project: { key: this.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
      description: toAdf(input.description, input.acceptanceCriteria),
    };
    if (input.parentKey) fields.parent = { key: input.parentKey };
    if (assignee) fields.assignee = assignee;
    // Sub-tasks inherit the parent's sprint; only set sprint on standalone/standard issues.
    if (this.sprintId && input.issueType !== 'Subtask') fields.customfield_10020 = this.sprintId;

    const res = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Jira createIssue (${input.issueType}) failed: ${res.status} — ${text}`);
      throw this.jiraError(`Failed to create Jira issue: ${res.status}`, text);
    }
    const data = (await res.json()) as JiraCreateResponse;
    return { key: data.key, url: `${this.baseUrl}/browse/${data.key}` };
  }

  async createIssueTree(root: DecomposedRoot): Promise<{ keys: string[] }> {
    const keys: string[] = [];
    const rootRes = await this.createOne({
      issueType: root.issueType,
      summary: root.summary,
      description: root.description,
      acceptanceCriteria: root.acceptanceCriteria,
    });
    keys.push(rootRes.key);

    if (root.issueType === 'Epic') {
      for (const child of root.children) {
        const childRes = await this.createOne({
          issueType: child.issueType,
          summary: child.summary,
          description: child.description,
          acceptanceCriteria: child.acceptanceCriteria,
          parentKey: rootRes.key,
        });
        keys.push(childRes.key);
        for (const st of child.subtasks) {
          const stRes = await this.createOne({
            issueType: 'Subtask',
            summary: st.summary,
            description: st.description,
            acceptanceCriteria: [],
            parentKey: childRes.key,
          });
          keys.push(stRes.key);
        }
      }
    } else {
      for (const st of root.subtasks) {
        const stRes = await this.createOne({
          issueType: 'Subtask',
          summary: st.summary,
          description: st.description,
          acceptanceCriteria: [],
          parentKey: rootRes.key,
        });
        keys.push(stRes.key);
      }
    }

    this.logger.log(`Jira issue tree created: ${keys.join(', ')}`);
    return { keys };
  }

  async addComment(key: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: toAdf(text, []) }),
    });
    if (!res.ok) {
      const text2 = await res.text().catch(() => '');
      this.logger.error(`Jira addComment ${key} failed: ${res.status} — ${text2}`);
      throw this.jiraError(`Failed to comment on Jira issue ${key}: ${res.status}`, text2);
    }
  }

  private jiraError(message: string, _detail: string): HttpException {
    // 502 Bad Gateway — the failure originates upstream (Jira), not in the caller's request.
    // Use the same { error: { code, message } } envelope as the rest of the API so the
    // client gets a consistent shape and the intended status code (a plain Error would
    // surface as a generic 500 — there is no global exception filter to honor a custom field).
    return new HttpException({ error: { code: 'JIRA_ERROR', message } }, HttpStatus.BAD_GATEWAY);
  }
}
