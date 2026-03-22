import { Injectable } from '@nestjs/common';

export interface CandidateExtract {
  fullName: string;
  email: string | null;
  phone: string | null;
  currentRole: string | null;
  yearsExperience: number | null;
  skills: string[];
  summary: string | null;
  source: 'direct' | 'agency' | 'linkedin' | 'referral' | 'website';
  suspicious: boolean;
}

@Injectable()
export class ExtractionAgentService {
  async extract(_fullText: string, _suspicious: boolean): Promise<CandidateExtract> {
    throw new Error('ExtractionAgentService.extract() not yet implemented');
  }
}
