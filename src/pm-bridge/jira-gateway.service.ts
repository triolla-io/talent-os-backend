import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toAdf } from './adf.util';
import type { IssueDraft } from './dto/ai-output.dto';

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

  async createIssue(issue: IssueDraft): Promise<JiraIssueResult> {
    const fields: Record<string, unknown> = {
      project: { key: this.projectKey },
      issuetype: { name: issue.issueType },
      summary: issue.summary,
      description: toAdf(issue.description, issue.acceptanceCriteria),
    };
    if (issue.suggestedEpicKey) {
      fields.parent = { key: issue.suggestedEpicKey };
    }
    if (this.sprintId) {
      fields.customfield_10020 = this.sprintId;
    }

    const res = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Jira createIssue failed: ${res.status} — ${text}`);
      throw this.jiraError(`Failed to create Jira issue: ${res.status}`, text);
    }

    const data = (await res.json()) as JiraCreateResponse;
    return { key: data.key, url: `${this.baseUrl}/browse/${data.key}` };
  }

  async updateIssue(targetKey: string, issue: IssueDraft): Promise<JiraIssueResult> {
    const fields: Record<string, unknown> = {
      issuetype: { name: issue.issueType },
      summary: issue.summary,
      description: toAdf(issue.description, issue.acceptanceCriteria),
    };

    const res = await fetch(`${this.baseUrl}/rest/api/3/issue/${targetKey}`, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Jira updateIssue ${targetKey} failed: ${res.status} — ${text}`);
      throw this.jiraError(`Failed to update Jira issue ${targetKey}: ${res.status}`, text);
    }

    return { key: targetKey, url: `${this.baseUrl}/browse/${targetKey}` };
  }

  private jiraError(message: string, _detail: string): HttpException {
    // 502 Bad Gateway — the failure originates upstream (Jira), not in the caller's request.
    // Use the same { error: { code, message } } envelope as the rest of the API so the
    // client gets a consistent shape and the intended status code (a plain Error would
    // surface as a generic 500 — there is no global exception filter to honor a custom field).
    return new HttpException({ error: { code: 'JIRA_ERROR', message } }, HttpStatus.BAD_GATEWAY);
  }
}
