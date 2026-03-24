import { Controller, Get, Post, Body, BadRequestException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobSchema } from './dto/create-job.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  async findAll() {
    return this.jobsService.findAll();
  }

  @Post()
  async create(@Body() body: unknown) {
    const result = CreateJobSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues,
      });
    }
    return this.jobsService.createJob(result.data);
  }
}
