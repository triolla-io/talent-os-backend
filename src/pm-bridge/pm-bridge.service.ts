import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraGatewayService } from './jira-gateway.service';
import { PmAiService } from './pm-ai.service';
import type { DraftRequest } from './dto/draft.dto';
import type { CommitRequest } from './dto/commit.dto';
import type { CreateDecision, UpdateDecision } from './dto/decision.dto';
import type { DraftVerdict } from './dto/ai-output.dto';

@Injectable()
export class PmBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraGateway: JiraGatewayService,
    private readonly pmAi: PmAiService,
  ) {}

  async draft(req: DraftRequest, tenantId: string): Promise<DraftVerdict> {
    const [tickets, decisions] = await Promise.all([
      this.jiraGateway.readBoard(),
      this.prisma.pmProductDecision.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return this.pmAi.draftAndValidate({ text: req.text, tickets, decisions });
  }

  async commit(req: CommitRequest, tenantId: string, createdBy: string) {
    if (req.action === 'update' && !req.targetKey) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'targetKey is required for action=update' },
      });
    }

    // Commit gate — only `create` is validated. Re-run AI validation against the submitted
    // issue (never trust the client): the fresh verdict may differ from the preview. This is the
    // security boundary, so validate the full submitted content — summary + description +
    // acceptance criteria — not just the title. `update` targets a known ticket and is not gated,
    // so we skip the board read, decisions query, and (costly) LLM validation entirely.
    if (req.action === 'create') {
      const [tickets, decisions] = await Promise.all([
        this.jiraGateway.readBoard(),
        this.prisma.pmProductDecision.findMany({
          where: { tenantId, status: 'active' },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const verdict = await this.pmAi.draftAndValidate({
        text: [req.issue.summary, req.issue.description, ...req.issue.acceptanceCriteria].filter(Boolean).join('\n'),
        tickets,
        decisions,
      });

      if (verdict.verdict.status !== 'clean' && !req.overrideReason) {
        throw new ConflictException({
          error: {
            code: 'VALIDATION_CONFLICT',
            message: 'Validation conflict — review the verdict and provide an override reason or adjust the issue',
            details: { verdict },
          },
        });
      }
    }

    const result =
      req.action === 'create'
        ? await this.jiraGateway.createIssue(req.issue)
        : await this.jiraGateway.updateIssue(req.targetKey!, req.issue);

    if (req.supersedesDecisionId) {
      await this.prisma.pmProductDecision.updateMany({
        where: { id: req.supersedesDecisionId, tenantId },
        data: { status: 'superseded' },
      });
    }

    return result;
  }

  async listDecisions(tenantId: string) {
    return this.prisma.pmProductDecision.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createDecision(data: CreateDecision, tenantId: string, createdBy: string) {
    return this.prisma.pmProductDecision.create({
      data: {
        tenantId,
        statement: data.statement,
        contextRoute: data.contextRoute,
        createdBy,
        status: 'active',
      },
    });
  }

  async updateDecision(id: string, data: UpdateDecision, tenantId: string) {
    const { count } = await this.prisma.pmProductDecision.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.supersededBy !== undefined && { supersededBy: data.supersededBy }),
        ...(data.statement !== undefined && { statement: data.statement }),
      },
    });

    if (count === 0) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Decision not found' } });
    }

    return this.prisma.pmProductDecision.findUniqueOrThrow({ where: { id } });
  }
}
