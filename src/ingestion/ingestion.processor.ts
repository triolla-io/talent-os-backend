import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PostmarkPayloadDto } from '../webhooks/dto/postmark-payload.dto';
import { SpamFilterService } from './services/spam-filter.service';
import { AttachmentExtractorService } from './services/attachment-extractor.service';
import { ExtractionAgentService, CandidateExtract } from './services/extraction-agent.service';
import { StorageService } from '../storage/storage.service';
import { DedupService, DedupResult } from '../dedup/dedup.service';
import { ScoringAgentService, ScoringInput } from '../scoring/scoring.service';

export interface ProcessingContext {
  fullText: string;
  suspicious: boolean;
  fileKey: string | null; // R2 object key (D-04) or null if no CV attachment found
  cvText: string; // Phase 3 extracted text — written to candidates.cv_text in Phase 7
  candidateId: string; // Phase 6 output — set immediately after INSERT/UPSERT; consumed by Phase 7
}

@Processor('ingest-email', {
  lockDuration: 30000,    // 30s lock per job (Issue Fix 1: prevents timeout on long-running scoring loops)
  lockRenewTime: 5000,    // renew lock every 5s
  maxStalledCount: 2,     // retry if stalled 2x
})
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly spamFilter: SpamFilterService,
    private readonly attachmentExtractor: AttachmentExtractorService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly extractionAgent: ExtractionAgentService,
    private readonly storageService: StorageService,
    private readonly dedupService: DedupService,
    private readonly scoringService: ScoringAgentService,
  ) {
    super();
  }

  async process(job: Job<PostmarkPayloadDto>): Promise<void> {
    const payload = job.data;
    const tenantId = this.config.get<string>('TENANT_ID')!;

    this.logger.log(`Processing job ${job.id} for MessageID: ${payload.MessageID}`);

    // Step 0: Spam filter FIRST — before any parsing (D-11)
    const filterResult = this.spamFilter.check(payload);

    if (filterResult.isSpam) {
      // D-12: Hard reject — update status to 'spam' and stop
      await this.prisma.emailIntakeLog.update({
        where: {
          idx_intake_message_id: { tenantId, messageId: payload.MessageID },
        },
        data: { processingStatus: 'spam' },
      });
      this.logger.log(`Spam filter rejected MessageID: ${payload.MessageID}`);
      return;
    }

    // D-13: Passed spam filter — update status to 'processing'
    await this.prisma.emailIntakeLog.update({
      where: {
        idx_intake_message_id: { tenantId, messageId: payload.MessageID },
      },
      data: { processingStatus: 'processing' },
    });

    // Step 1: Extract text from attachments (D-02, D-03)
    const attachmentText = await this.attachmentExtractor.extract(payload.Attachments ?? []);

    // Build fullText: email body first, then attachment sections (D-02)
    const bodySection = payload.TextBody?.trim() ? `--- Email Body ---\n${payload.TextBody.trim()}` : '';

    const fullText = [bodySection, attachmentText].filter(Boolean).join('\n\n');

    // Phase 3 output — passed to Phase 4 inline
    const context: ProcessingContext = {
      fullText,
      suspicious: filterResult.suspicious,
      fileKey: null, // populated after Phase 5 upload below
      cvText: fullText, // same as fullText — alias for Phase 7 clarity
      candidateId: '', // set by Phase 6 below
    };

    // Phase 5: Upload original CV to Cloudflare R2 BEFORE AI extraction (D-07: errors propagate to BullMQ, no catch)
    // BUG-CV-LOSS fix: upload must happen before extraction so the file is persisted even if AI fails
    const fileKey = await this.storageService.upload(payload.Attachments ?? [], tenantId, payload.MessageID);
    context.fileKey = fileKey;
    context.cvText = fullText;

    this.logger.log(`Phase 5 complete for MessageID: ${payload.MessageID} — fileKey: ${fileKey ?? 'none'}`);

    // Phase 4: AI extraction (D-06 mock — real call activated in follow-up task)
    let extraction: CandidateExtract;
    try {
      extraction = await this.extractionAgent.extract(context.fullText, context.suspicious);
    } catch (err) {
      // D-04: extraction failure → mark as failed, do not insert placeholder
      await this.prisma.emailIntakeLog.update({
        where: {
          idx_intake_message_id: { tenantId, messageId: payload.MessageID },
        },
        data: { processingStatus: 'failed' },
      });
      this.logger.error(`Extraction failed for MessageID: ${payload.MessageID} — ${(err as Error).message}`);
      // BUG-RETRY fix: re-throw so BullMQ sees a failure and retries via exponential backoff
      throw err;
    }

    // D-04, D-05: empty fullName is treated the same as extraction failure (permanent — do not retry)
    if (!extraction.fullName?.trim()) {
      await this.prisma.emailIntakeLog.update({
        where: {
          idx_intake_message_id: { tenantId, messageId: payload.MessageID },
        },
        data: { processingStatus: 'failed' },
      });
      this.logger.error(`Extraction returned empty fullName for MessageID: ${payload.MessageID}`);
      return;
    }

    this.logger.log(`Phase 4 complete for MessageID: ${payload.MessageID} — extracted: ${extraction.fullName}`);

    // Phase 6: Duplicate detection + minimal candidate shell INSERT/UPSERT (atomic)
    // dedupService.check() runs OUTSIDE the transaction — read-only query, no benefit from holding lock
    const dedupResult: DedupResult | null = await this.dedupService.check(extraction, tenantId);

    let candidateId!: string;

    await this.prisma.$transaction(async (tx) => {
      if (dedupResult && dedupResult.confidence === 1.0) {
        // Exact email match (DEDUP-02): UPSERT existing candidate — update fullName + phone only
        // source and sourceEmail are NEVER updated — first-submission ROI attribution (D-07)
        await this.dedupService.upsertCandidate(dedupResult.match.id, extraction, tx);
        candidateId = dedupResult.match.id; // Use existing candidate ID (D-11)
      } else if (dedupResult && dedupResult.confidence < 1.0) {
        // Fuzzy name match (DEDUP-03): INSERT new candidate shell + create duplicate_flags for human review
        // Never auto-merge — DEDUP-05, D-12
        candidateId = await this.dedupService.insertCandidate(extraction, tenantId, payload.From, tx);
        await this.dedupService.createFlag(candidateId, dedupResult.match.id, dedupResult.confidence, tenantId, tx);
      } else {
        // No match (DEDUP-04): INSERT new candidate shell
        candidateId = await this.dedupService.insertCandidate(extraction, tenantId, payload.From, tx);
      }

      // D-10: Set email_intake_log.candidate_id atomically — if this fails, candidate INSERT rolls back too
      await tx.emailIntakeLog.update({
        where: { idx_intake_message_id: { tenantId, messageId: payload.MessageID } },
        data: { candidateId: candidateId! },
      });
    });

    // Pass candidateId to Phase 7 via context (D-16)
    context.candidateId = candidateId!;

    this.logger.log(`Phase 6 complete for MessageID: ${payload.MessageID} — candidateId: ${candidateId}`);

    // Phase 7: Candidate enrichment (CAND-01, D-01, D-02, D-03)
    await this.prisma.candidate.update({
      where: { id: context.candidateId },
      data: {
        currentRole: extraction.currentRole ?? null,
        yearsExperience: extraction.yearsExperience ?? null,
        skills: extraction.skills ?? [],
        cvText: context.cvText,
        cvFileUrl: context.fileKey, // R2 object key used as URL placeholder in Phase 1 (D-02)
        aiSummary: extraction.summary ?? null,
        metadata: Prisma.JsonNull,   // D-03: deferred to future phase (Prisma requires JsonNull not null)
      },
    });

    this.logger.log(`Phase 7 enrichment complete for MessageID: ${payload.MessageID}`);

    // Phase 7: Active jobs fetch (SCOR-01, D-11)
    const activeJobs = await this.prisma.job.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, title: true, description: true, requirements: true },
    });

    // D-11: if no active jobs, skip loop entirely — still mark as completed
    for (const job of activeJobs) {
      // SCOR-02 (D-12): upsert application row first — idempotent on retry
      const application = await this.prisma.application.upsert({
        where: {
          idx_applications_unique: {
            tenantId,
            candidateId: context.candidateId,
            jobId: job.id,
          },
        },
        create: { tenantId, candidateId: context.candidateId, jobId: job.id, stage: 'new' },
        update: {}, // No-op on retry — idempotent
        select: { id: true },
      });

      // SCOR-03 (D-07): score candidate against job with error isolation (Issue Fix 2)
      let scoreResult;
      try {
        scoreResult = await this.scoringService.score({
          cvText: context.cvText,
          candidateFields: {
            currentRole: extraction.currentRole ?? null,
            yearsExperience: extraction.yearsExperience ?? null,
            skills: extraction.skills ?? [],
          },
          job: {
            title: job.title,
            description: job.description ?? null,
            requirements: job.requirements,
          },
        } satisfies ScoringInput);
      } catch (err) {
        // Issue Fix 2: Log and continue — don't fail the entire candidate on one bad job score
        this.logger.error(
          `Scoring failed for candidateId: ${context.candidateId}, jobId: ${job.id} — ${(err as Error).message}`,
        );
        // D-13: If we skip the INSERT on error, this application has no score. This is acceptable.
        // Phase 2 can filter applications without scores if needed.
        continue;
      }

      // SCOR-04, SCOR-05 (D-13): append-only INSERT — never upsert
      // D-13: Score INSERTs are append-only. Retries will create duplicate rows — acceptable for Phase 1.
      await this.prisma.candidateJobScore.create({
        data: {
          tenantId,
          applicationId: application.id,
          score: scoreResult.score,
          reasoning: scoreResult.reasoning,
          strengths: scoreResult.strengths,
          gaps: scoreResult.gaps,
          modelUsed: scoreResult.modelUsed,
        },
      });

      this.logger.log(`Phase 7 scored candidateId: ${context.candidateId} against jobId: ${job.id} — score: ${scoreResult.score}`);
    }

    // D-16: terminal status — set AFTER all Phase 7 work completes (only reached if no error thrown)
    await this.prisma.emailIntakeLog.update({
      where: { idx_intake_message_id: { tenantId, messageId: payload.MessageID } },
      data: { processingStatus: 'completed' },
    });

    this.logger.log(`Phase 7 complete for MessageID: ${payload.MessageID} — pipeline finished`);
  }
}
