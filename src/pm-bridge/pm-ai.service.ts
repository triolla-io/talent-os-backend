import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  ClarifyResultSchema, type ClarifyResult,
  ValidationResultSchema, type ValidationResult,
  DecomposeResultSchema, type DecomposeResult,
} from './dto/ai-output.dto';
import type { Turn, Page } from './dto/converse.dto';
import type { InternalBrief } from './dto/brief.dto';
import type { CondensedTicket } from './jira-gateway.service';
import type { PmProductDecision } from '@prisma/client';

export interface ClarifyInput {
  messages: Turn[];
  board: CondensedTicket[];
  decisions: PmProductDecision[];
  page: Page;
  roundsUsed: number;
}

const CLARIFY_SYSTEM = `You are a sharp, skeptical senior technical PM talking to a NON-technical, impulsive product manager. Your job is to understand what he actually wants — never to expose Jira, tickets, or any technical structure.

Decide between two outputs:
- type "clarify": ask 1–3 SHORT plain-English questions. Use questions to (a) resolve vagueness, (b) catch self-contradiction, and (c) when the request looks like work already in progress, ask a plain yes/no — e.g. "This sounds like the search-speed work already underway — same thing, or new?". NEVER mention ticket keys, issue types, or Jira. Provide tappable "chips" (likely answers) whenever the answers are predictable; set allowFreeText true.
- type "ready": only when you genuinely understand the goal. Emit "goal" (ONE plain sentence the PM will confirm — no jargon) and a complete hidden "brief".

Rules:
- Be conservative about "ready". If the ask is vague, contradictory, or could mean very different things, clarify instead.
- The "brief" is hidden from the PM; write it for a developer. sizeHint: "tiny" = a one-line tweak, "medium" = a single feature slice, "large" = a multi-part feature. devNotes = concrete technical seeds the developer will need.
- When type is "clarify": questions non-empty, goal "", brief null. When type is "ready": questions [], goal set, brief set.

WRITING STYLE — applies to EVERY word the PM will read (each question "prompt", every "chip", and the "goal"): write in easy, everyday English for a busy, severely-ADHD, non-technical reader. One idea per sentence. Short sentences. Common daily words — no jargon, no technical terms, no Jira words. Keep each question to a single line; keep chips to 1–3 plain words. Make it instantly skimmable. This does NOT apply to the hidden "brief", which you write for a developer.`;

const VALIDATE_SYSTEM = `You are a strict reviewer guarding a Jira board. You are given a developer brief and the list of open tickets + active product decisions. Decide:
- "clean": no meaningful overlap and it breaks no decision.
- "duplicate": the same work already exists. Set duplicateOfKey to that ticket's key.
- "conflict": it contradicts/overrides an open ticket OR violates a product decision. List conflictingDecisionIds and explain in reasonPlain.
Be conservative — only flag real overlap or real contradiction, not superficial similarity. reasonPlain must be plain English a non-technical person could read.`;

const DECOMPOSE_SYSTEM = `You are a senior engineer turning a product brief into a right-sized Jira plan. Jira hierarchy is exactly 3 levels: Epic ▸ Story/Task/Bug ▸ Sub-task. Do NOT exceed it.
Right-size by sizeHint and your own judgement:
- "tiny": root is a single Task (or Bug); no children, no subtasks.
- "medium": root is a single Story (or Task); no children; 1–6 Sub-tasks that are the developer checklist.
- "large": root is an Epic; children are Stories/Tasks; each child may have Sub-tasks.
Enrich every issue with the concrete technical detail the developer needs (the PM did not provide it): clear descriptions, testable acceptanceCriteria on Stories/Tasks, and actionable Sub-tasks. Sub-tasks need only summary + description. Write developer-facing English (this is never shown to the PM).`;

@Injectable()
export class PmAiService {
  private readonly logger = new Logger(PmAiService.name);
  private readonly openrouter: ReturnType<typeof createOpenRouter>;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openrouter = createOpenRouter({ apiKey: config.get<string>('OPENROUTER_API_KEY')! });
    this.model = config.get<string>('PM_BRIDGE_MODEL') ?? 'anthropic/claude-sonnet-4.6';
  }

  async clarify(input: ClarifyInput): Promise<ClarifyResult> {
    const transcript = input.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const board = input.board.length
      ? input.board.map((t) => `- [${t.key}] (${t.type}, ${t.status}) ${t.summary}`).join('\n')
      : '(no open tickets)';
    const decisions = input.decisions.filter((d) => d.status === 'active').length
      ? input.decisions.filter((d) => d.status === 'active').map((d) => `- [${d.id}] ${d.statement}`).join('\n')
      : '(no recorded product decisions)';

    const prompt = [
      `Where the PM is in the app: ${input.page.name} (${input.page.route})`,
      `Clarify rounds already used: ${input.roundsUsed}`,
      '',
      'Conversation so far:',
      transcript,
      '',
      'Work already in progress (for spotting overlap — NEVER reveal these to the PM):',
      board,
      '',
      'Recorded product decisions (rules the PM must not silently break):',
      decisions,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: ClarifyResultSchema,
      schemaName: 'PmBridgeClarify',
      system: CLARIFY_SYSTEM,
      prompt,
      temperature: 0,
    });

    this.logger.log(`PM Bridge clarify: type=${object.type} questions=${object.questions.length}`);
    return object;
  }

  async validate(input: {
    brief: InternalBrief;
    board: CondensedTicket[];
    decisions: PmProductDecision[];
  }): Promise<ValidationResult> {
    const board = input.board.length
      ? input.board.map((t) => `- [${t.key}] (${t.type}, ${t.status}) ${t.summary}`).join('\n')
      : '(no open tickets)';
    const decisions = input.decisions.filter((d) => d.status === 'active').length
      ? input.decisions.filter((d) => d.status === 'active').map((d) => `- [${d.id}] ${d.statement}`).join('\n')
      : '(no recorded product decisions)';

    const prompt = [
      'Developer brief:',
      JSON.stringify(input.brief, null, 2),
      '',
      'Open tickets:',
      board,
      '',
      'Active product decisions:',
      decisions,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: ValidationResultSchema,
      schemaName: 'PmBridgeValidation',
      system: VALIDATE_SYSTEM,
      prompt,
      temperature: 0,
    });
    this.logger.log(`PM Bridge validate: ${object.status}`);
    return object;
  }

  async decompose(input: { brief: InternalBrief }): Promise<DecomposeResult> {
    const prompt = [
      'Turn this brief into a right-sized Jira plan:',
      JSON.stringify(input.brief, null, 2),
      '',
      `The PM-facing goal is: "${input.brief.goal}"`,
      `Suggested size: ${input.brief.sizeHint} (use your judgement).`,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: DecomposeResultSchema,
      schemaName: 'PmBridgeDecompose',
      system: DECOMPOSE_SYSTEM,
      prompt,
      temperature: 0,
    });
    this.logger.log(`PM Bridge decompose: size=${object.size} root=${object.root.issueType}`);
    return object;
  }
}
