import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateExtract } from '../ingestion/services/extraction-agent.service';

export interface FuzzyMatch {
  id: string;
  full_name: string;
  name_sim: number;
}

export interface DedupResult {
  match: { id: string };
  confidence: number;
  fields: string[];
}

@Injectable()
export class DedupService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    _candidate: CandidateExtract,
    _tenantId: string,
  ): Promise<DedupResult | null> {
    // Phase 6 Plan 01 — implementation pending
    throw new Error('DedupService.check() not yet implemented');
  }

  async insertCandidate(
    _candidate: CandidateExtract,
    _tenantId: string,
    _fromEmail: string,
  ): Promise<string> {
    throw new Error('DedupService.insertCandidate() not yet implemented');
  }

  async upsertCandidate(
    _candidateId: string,
    _candidate: CandidateExtract,
  ): Promise<void> {
    throw new Error('DedupService.upsertCandidate() not yet implemented');
  }

  async createFlag(
    _candidateId: string,
    _matchedCandidateId: string,
    _confidence: number,
    _tenantId: string,
  ): Promise<void> {
    throw new Error('DedupService.createFlag() not yet implemented');
  }
}
