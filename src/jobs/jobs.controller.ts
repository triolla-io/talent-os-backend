import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
  HttpCode,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { JobsService } from './jobs.service';
import { CreateJobSchema, CreateJobDto } from './dto/create-job.dto';

@UseGuards(SessionGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  async findAll(@Req() req: Request, @Query('status') status?: string) {
    const tenantId = req.session!.org;
    return this.jobsService.findAll(tenantId, status);
  }

  @Get('list')
  async getOpenJobs(@Req() req: Request) {
    const tenantId = req.session!.org;
    return this.jobsService.getOpenJobs(tenantId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const tenantId = req.session!.org;
    return this.jobsService.findOne(id, tenantId);
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: Request) {
    const tenantId = req.session!.org;
    const dto = this.parseJobBody(body);
    return this.jobsService.createJob(dto, tenantId);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const tenantId = req.session!.org;
    const dto = this.parseJobBody(body);
    try {
      return await this.jobsService.updateJob(id, dto, tenantId);
    } catch (error: any) {
      // Prisma P2025: record not found
      if (error?.code === 'P2025' || error instanceof NotFoundException) {
        throw new NotFoundException({
          error: {
            code: 'NOT_FOUND',
            message: 'Job not found',
          },
        });
      }
      throw error;
    }
  }

  /** Soft-delete (status → closed) */
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: Request) {
    const tenantId = req.session!.org;
    try {
      await this.jobsService.deleteJob(id, tenantId);
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException({
          error: {
            code: 'NOT_FOUND',
            message: 'Job not found',
          },
        });
      }
      throw error;
    }
  }

  /**
   * Hard-delete a job and all related data:
   * - JobStages, ScreeningQuestions, Applications, CandidateJobScores (cascade)
   * - Candidates linked to the job get jobId and hiringStageId set to null (SetNull)
   */
  @Delete(':id/hard')
  @HttpCode(204)
  async hardDelete(@Param('id') id: string, @Req() req: Request) {
    const tenantId = req.session!.org;
    try {
      await this.jobsService.hardDeleteJob(id, tenantId);
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Job not found' },
        });
      }
      throw error;
    }
  }

  /**
   * Validate a raw request body against CreateJobSchema.
   * Throws BadRequestException with field-level details on failure; returns the typed DTO otherwise.
   */
  private parseJobBody(body: unknown): CreateJobDto {
    const result = CreateJobSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: this.formatZodErrors(result.error),
        },
      });
    }
    return result.data;
  }

  /**
   * Helper method to format Zod validation errors
   * Converts ZodError.issues into field error structure
   */
  private formatZodErrors(error: ZodError): Record<string, string[]> {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';

      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    }

    return fieldErrors;
  }
}
