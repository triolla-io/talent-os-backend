import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { DraftVerdictSchema, type DraftVerdict } from './dto/ai-output.dto';
import type { CondensedTicket } from './jira-gateway.service';
import type { PmProductDecision } from '@prisma/client';

export interface DraftAndValidateInput {
  text: string;
  tickets: CondensedTicket[];
  decisions: PmProductDecision[];
}

const SYSTEM_PROMPT = `You are a technical PM assistant with two jobs:

**Job 1 — Draft a well-formed Jira issue** from the PM's raw text:
- issueType: one of Epic, Story, Task, Bug
- summary: concise one-line title
- description: clear, actionable description
- acceptanceCriteria: 2–5 concrete, testable conditions
- suggestedEpicKey: only set if an Epic in the supplied tickets is a clear parent; otherwise omit

**Job 2 — Validate ("don't believe the PM")**: compare the drafted issue against every supplied ticket and product decision:
- status: "clean" if no significant overlap; "duplicate" if nearly identical work already exists; "conflict_ticket" if it contradicts or overrides an open ticket; "conflict_decision" if it contradicts a product decision
- relatedTickets: list tickets with plain-language explanations of the relationship
- conflictingDecisions: list decisions the issue would violate, with plain-language explanation
- recommendedAction: "create" (no conflicts), "update" (should update existing ticket), "review" (PM should review before proceeding)
- recommendedTargetKey: only set when recommendedAction is "update"

Be conservative: a clean draft should be genuinely clean, not just superficially different. Surface real conflicts, not invented ones.

**Writing style — IMPORTANT:** All text you write in description, acceptanceCriteria items, and every explanationPlain field must use plain, simple English:
- Short sentences. One idea per sentence.
- Use common everyday words. Avoid jargon and technical buzzwords.
- No long paragraphs. Use bullet points where possible.
- If you must use a technical term, explain it in brackets right after — e.g. "API (the connection between two systems)".
- Write as if explaining to someone who is skimming quickly, not reading slowly.`;

@Injectable()
export class PmAiService {
  private readonly logger = new Logger(PmAiService.name);
  private readonly openrouter: ReturnType<typeof createOpenRouter>;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openrouter = createOpenRouter({ apiKey: config.get<string>('OPENROUTER_API_KEY')! });
    this.model = config.get<string>('PM_BRIDGE_MODEL') ?? 'anthropic/claude-sonnet-4.6';
  }

  async draftAndValidate(input: DraftAndValidateInput): Promise<DraftVerdict> {
    const ticketList =
      input.tickets.length > 0
        ? input.tickets.map((t) => `- [${t.key}] (${t.type}, ${t.status}) ${t.summary}`).join('\n')
        : '(no open tickets)';

    const decisionList =
      input.decisions.length > 0
        ? input.decisions
            .filter((d) => d.status === 'active')
            .map((d) => `- [${d.id}] ${d.statement}`)
            .join('\n')
        : '(no recorded product decisions)';

    const prompt = [
      `PM's input: "${input.text}"`,
      '',
      'Open Jira tickets:',
      ticketList,
      '',
      'Recorded product decisions:',
      decisionList,
    ].join('\n');

    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: DraftVerdictSchema,
      schemaName: 'PmBridgeDraftVerdict',
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
    });

    this.logger.log(`PM Bridge draft verdict: ${object.verdict.status}`);
    return object;
  }
}
