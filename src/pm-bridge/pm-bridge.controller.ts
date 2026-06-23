import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { PmBridgeGuard } from './pm-bridge.guard';
import { PmBridgeService } from './pm-bridge.service';
import { ConverseRequestSchema } from './dto/converse.dto';
import { CommitRequestSchema } from './dto/commit.dto';
import { CreateDecisionSchema, UpdateDecisionSchema } from './dto/decision.dto';

@UseGuards(SessionGuard, PmBridgeGuard)
@Controller('pm-bridge')
export class PmBridgeController {
  constructor(private readonly service: PmBridgeService) {}

  @Post('converse')
  async converse(@Body() body: unknown, @Req() req: Request) {
    const result = ConverseRequestSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.converse(result.data, req.session!.org, req.pmBridgeEmail!);
  }

  @Post('commit')
  async commit(@Body() body: unknown, @Req() req: Request) {
    const result = CommitRequestSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.commit(result.data, req.session!.org, req.pmBridgeEmail!);
  }

  @Get('decisions')
  async listDecisions(@Req() req: Request) {
    return this.service.listDecisions(req.session!.org);
  }

  @Post('decisions')
  async createDecision(@Body() body: unknown, @Req() req: Request) {
    const result = CreateDecisionSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.createDecision(result.data, req.session!.org, req.pmBridgeEmail!);
  }

  @Patch('decisions/:id')
  async updateDecision(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const result = UpdateDecisionSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: this.formatZodErrors(result.error) },
      });
    }
    return this.service.updateDecision(id, result.data, req.session!.org);
  }

  private formatZodErrors(error: ZodError): Record<string, string[]> {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    return fieldErrors;
  }
}
