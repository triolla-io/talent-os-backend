import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export type CandidateFilter = 'all' | 'high-score' | 'available' | 'referred' | 'duplicates';

export interface CandidateResponse {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_role: string | null;
  location: string | null;
  cv_file_url: string | null;
  source: string;
  created_at: Date;
  ai_score: number | null;
  is_duplicate: boolean;
  skills: string[];
}

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(
    q?: string,
    filter?: CandidateFilter,
  ): Promise<{ candidates: CandidateResponse[]; total: number }> {
    const tenantId = this.configService.get<string>('TENANT_ID')!;

    // Build WHERE conditions
    const where: Record<string, unknown> = { tenantId };

    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { currentRole: { contains: q, mode: 'insensitive' } },
      ];
    }

    // filter='available': no application in hired or rejected stage
    if (filter === 'available') {
      where.applications = {
        none: { stage: { in: ['hired', 'rejected'] } },
      };
    }

    // filter='referred': source = 'referral'
    if (filter === 'referred') {
      where.source = 'referral';
    }

    // filter='duplicates': has unreviewed duplicate_flag
    if (filter === 'duplicates') {
      where.duplicateFlags = {
        some: { reviewed: false },
      };
    }

    const candidates = await this.prisma.candidate.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        currentRole: true,
        location: true,
        cvFileUrl: true,
        source: true,
        createdAt: true,
        skills: true,
        applications: {
          select: {
            scores: {
              select: { score: true },
            },
          },
        },
        duplicateFlags: {
          where: { reviewed: false },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Compute derived fields and map to snake_case
    let result: CandidateResponse[] = candidates.map((c) => {
      // ai_score = MAX score across all applications' scores
      const allScores = c.applications.flatMap((a) => a.scores.map((s) => s.score));
      const aiScore = allScores.length > 0 ? Math.max(...allScores) : null;

      return {
        id: c.id,
        full_name: c.fullName,
        email: c.email,
        phone: c.phone,
        current_role: c.currentRole,
        location: c.location,
        cv_file_url: c.cvFileUrl,
        source: c.source,
        created_at: c.createdAt,
        ai_score: aiScore,
        is_duplicate: c.duplicateFlags.length > 0,
        skills: c.skills,
      };
    });

    // filter='high-score': ai_score >= 70 (post-query filter since ai_score is computed)
    if (filter === 'high-score') {
      result = result.filter((c) => c.ai_score !== null && c.ai_score >= 70);
    }

    return { candidates: result, total: result.length };
  }
}
