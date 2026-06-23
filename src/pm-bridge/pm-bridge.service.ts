import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraGatewayService } from './jira-gateway.service';
import { PmAiService } from './pm-ai.service';
import { PmNotifyService } from './pm-notify.service';
import type { ConverseRequest, ConverseResponse, Turn } from './dto/converse.dto';
import type { CommitRequest, CommitResponse } from './dto/commit.dto';
import type { CreateDecision, UpdateDecision } from './dto/decision.dto';
import type { InternalBrief } from './dto/brief.dto';

const MAX_CLARIFY_ROUNDS = 3;

@Injectable()
export class PmBridgeService {
  private readonly logger = new Logger(PmBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraGateway: JiraGatewayService,
    private readonly pmAi: PmAiService,
    private readonly pmNotify: PmNotifyService,
  ) {}

  async converse(req: ConverseRequest, tenantId: string, createdBy: string): Promise<ConverseResponse> {
    const [board, decisions] = await Promise.all([
      this.jiraGateway.readBoard(),
      this.prisma.pmProductDecision.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const roundsUsed = req.messages.filter((m) => m.role === 'assistant').length;
    const result = await this.pmAi.clarify({ messages: req.messages, board, decisions, page: req.page, roundsUsed });

    if (result.type === 'ready' && result.brief) {
      return { type: 'ready', goal: result.goal, brief: result.brief };
    }

    // Still not ready. Stop badgering after the cap and hand off to Daniel rather than
    // auto-filing something we could not pin down.
    if (roundsUsed >= MAX_CLARIFY_ROUNDS) {
      const rawText = this.firstPmText(req.messages);
      const brief: InternalBrief = {
        goal: result.goal || '(unclear request)',
        problem: rawText,
        desiredOutcomes: [],
        constraints: [],
        affectedArea: req.page,
        sizeHint: 'tiny',
        devNotes: [],
        rawText,
        conversationDigest: req.messages.map((m) => `${m.role}: ${m.content}`).join(' | '),
      };
      await this.createHold({
        tenantId, createdBy, rawText, goal: brief.goal, brief,
        conversation: req.messages,
        reasonPlain: 'The request stayed unclear after several questions, so it was sent to you instead of filed.',
      });
      return { type: 'held' };
    }

    return { type: 'clarify', questions: result.questions };
  }

  async commit(req: CommitRequest, tenantId: string, createdBy: string): Promise<CommitResponse> {
    const [board, decisions] = await Promise.all([
      this.jiraGateway.readBoard(),
      this.prisma.pmProductDecision.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const validation = await this.pmAi.validate({ brief: req.brief, board, decisions });

    if (validation.status === 'clean') {
      const { keys } = await this.buildAndFile(req.brief);
      this.logger.log(`PM Bridge filed ${keys.length} issue(s): ${keys.join(', ')}`);
      return { type: 'filed' };
    }

    if (validation.status === 'duplicate' && validation.duplicateOfKey) {
      await this.jiraGateway.addComment(
        validation.duplicateOfKey,
        `PM follow-up via PM Bridge — goal: ${req.brief.goal}\n\n${req.brief.rawText}`,
      );
      return { type: 'merged' };
    }

    // conflict (or duplicate with no key) → hold for Daniel
    await this.createHold({
      tenantId, createdBy,
      rawText: req.brief.rawText,
      goal: req.brief.goal,
      brief: req.brief,
      conversation: [],
      reasonPlain: validation.reasonPlain || 'It clashes with existing work.',
    });
    return { type: 'held' };
  }

  async approveHold(itemId: string): Promise<{ status: 'approved' | 'already_resolved'; keys?: string[] }> {
    const hold = await this.prisma.pmHeldRequest.findUnique({ where: { id: itemId } });
    if (!hold) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Held request not found' } });
    if (hold.status !== 'pending') return { status: 'already_resolved' };

    const brief = hold.brief as unknown as InternalBrief;
    const { keys } = await this.buildAndFile(brief);
    await this.prisma.pmHeldRequest.update({
      where: { id: itemId },
      data: { status: 'approved', jiraKeys: keys as unknown as Prisma.InputJsonValue, resolvedAt: new Date() },
    });
    this.logger.log(`PM Bridge hold ${itemId} approved → ${keys.join(', ')}`);
    return { status: 'approved', keys };
  }

  async rejectHold(itemId: string): Promise<{ status: 'rejected' | 'already_resolved' }> {
    const hold = await this.prisma.pmHeldRequest.findUnique({ where: { id: itemId } });
    if (!hold) throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Held request not found' } });
    if (hold.status !== 'pending') return { status: 'already_resolved' };

    await this.prisma.pmHeldRequest.update({
      where: { id: itemId },
      data: { status: 'rejected', resolvedAt: new Date() },
    });
    this.logger.log(`PM Bridge hold ${itemId} rejected`);
    return { status: 'rejected' };
  }

  private async buildAndFile(brief: InternalBrief): Promise<{ keys: string[] }> {
    const plan = await this.pmAi.decompose({ brief });
    return this.jiraGateway.createIssueTree(plan.root);
  }

  private async createHold(input: {
    tenantId: string;
    createdBy: string;
    rawText: string;
    goal: string;
    brief: InternalBrief;
    conversation: Turn[];
    reasonPlain: string;
  }): Promise<void> {
    const hold = await this.prisma.pmHeldRequest.create({
      data: {
        tenantId: input.tenantId,
        rawText: input.rawText,
        goal: input.goal,
        conversation: input.conversation as unknown as Prisma.InputJsonValue,
        brief: input.brief as unknown as Prisma.InputJsonValue,
        verdict: { reasonPlain: input.reasonPlain } as unknown as Prisma.InputJsonValue,
        status: 'pending',
        createdBy: input.createdBy,
      },
    });
    await this.pmNotify.notifyHeld({
      holdId: hold.id,
      rawText: input.rawText,
      goal: input.goal,
      reasonPlain: input.reasonPlain,
    });
  }

  private firstPmText(messages: Turn[]): string {
    return messages.find((m) => m.role === 'pm')?.content ?? '';
  }

  // ── decisions (unchanged) ───────────────────────────────────────────────────
  listDecisions(tenantId: string) {
    return this.prisma.pmProductDecision.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  createDecision(data: CreateDecision, tenantId: string, createdBy: string) {
    return this.prisma.pmProductDecision.create({
      data: { tenantId, statement: data.statement, contextRoute: data.contextRoute, createdBy, status: 'active' },
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
