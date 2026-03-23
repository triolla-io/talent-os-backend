import { Controller, Get, Query } from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import type { CandidateFilter } from './candidates.service';

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  async findAll(
    @Query('q') q?: string,
    @Query('filter') filter?: CandidateFilter,
  ) {
    return this.candidatesService.findAll(q, filter);
  }
}
