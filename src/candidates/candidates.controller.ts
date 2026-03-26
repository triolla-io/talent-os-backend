import 'multer';
import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodError } from 'zod';
import { CandidatesService } from './candidates.service';
import type { CandidateFilter } from './candidates.service';
import { CreateCandidateSchema } from './dto/create-candidate.dto';
import { CandidateResponse } from './dto/candidate-response.dto';

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  /**
   * Retrieve all candidates for the tenant
   * @param q Optional search query (name, email, role)
   * @param filter Optional filter: all, high-score, available, referred, duplicates
   * @returns Candidates with hiring stage info for Kanban board rendering
   */
  @Get()
  async findAll(@Query('q') q?: string, @Query('filter') filter?: CandidateFilter): Promise<{ candidates: CandidateResponse[]; total: number }> {
    return this.candidatesService.findAll(q, filter);
  }

  /**
   * Create a new candidate with file upload
   * Auto-assigns candidate to the first hiring stage of the specified job
   * @returns Newly created candidate with assigned hiring stage
   */
  @Post()
  @UseInterceptors(FileInterceptor('cv_file'))
  async create(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown): Promise<Record<string, unknown>> {
    const result = CreateCandidateSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = this.formatZodErrors(result.error);
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: fieldErrors,
        },
      });
    }
    return this.candidatesService.createCandidate(result.data, file);
  }

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
