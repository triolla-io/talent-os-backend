import { Module } from '@nestjs/common';
import { ScoringAgentService } from './scoring.service';

@Module({
  providers: [ScoringAgentService],
  exports: [ScoringAgentService],
})
export class ScoringModule {}
