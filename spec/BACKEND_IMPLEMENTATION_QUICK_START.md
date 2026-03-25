# Backend Implementation Quick Start

**For:** telent-os-backend developer
**Reference:** `API_PROTOCOL_MVP.md` (source of truth for schemas)
**Time:** ~10-12 hours for one developer

---

## 1. Database Migrations (1-2 hours)

### JobStage table changes:

```sql
-- 1. Add missing columns
ALTER TABLE job_stages ADD COLUMN is_enabled BOOLEAN DEFAULT true;
ALTER TABLE job_stages ADD COLUMN color VARCHAR(50) NOT NULL DEFAULT 'bg-zinc-400';

-- 2. Rename column (or add new one if renaming is risky)
-- Option A: Direct rename
ALTER TABLE job_stages RENAME COLUMN responsible_user_id TO interviewer;
ALTER TABLE job_stages ALTER COLUMN interviewer TYPE TEXT;

-- Option B: Safe migration (create, copy, drop)
ALTER TABLE job_stages ADD COLUMN interviewer TEXT;
UPDATE job_stages SET interviewer = responsible_user_id::text WHERE responsible_user_id IS NOT NULL;
DROP COLUMN responsible_user_id;

-- 3. Ensure correct index
CREATE INDEX IF NOT EXISTS idx_job_stages_job_order ON job_stages(job_id, "order");
```

### ScreeningQuestion table changes:

```sql
-- 1. Add expected_answer column
ALTER TABLE screening_questions ADD COLUMN expected_answer VARCHAR(255);

-- 2. Remove columns (optional - you can ignore these in API response)
-- ALTER TABLE screening_questions DROP COLUMN required;
-- ALTER TABLE screening_questions DROP COLUMN knockout;

-- 3. Ensure correct index
CREATE INDEX IF NOT EXISTS idx_screening_questions_job ON screening_questions(job_id);
```

### Test the migrations:
```bash
npm run migrate:dev
# Verify schema with: npx prisma studio
```

---

## 2. Update Prisma Schema (30 mins)

Edit `prisma/schema.prisma`:

```prisma
model JobStage {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  jobId             String   @map("job_id") @db.Uuid
  name              String   @db.Text
  order             Int      @db.SmallInt
  interviewer       String?  @map("interviewer") @db.Text  // Changed: was responsibleUserId
  isEnabled         Boolean  @default(true) @map("is_enabled")  // NEW
  color             String   @map("color") @db.Text  // NEW
  isCustom          Boolean  @default(false) @map("is_custom")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz

  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  job          Job           @relation(fields: [jobId], references: [id], onDelete: Cascade)
  applications Application[]

  @@index([jobId, order], name: "idx_job_stages_job_order")
  @@map("job_stages")
}

model ScreeningQuestion {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String   @map("tenant_id") @db.Uuid
  jobId          String   @map("job_id") @db.Uuid
  text           String   @db.Text
  answerType     String   @map("answer_type") @db.Text  // Keep answerType internally
  expectedAnswer String?  @map("expected_answer") @db.Text  // NEW
  order          Int      @db.SmallInt
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz

  // You can keep 'required' & 'knockout' columns but don't expose them in API
  required       Boolean  @default(false)  // Hide from API responses
  knockout       Boolean  @default(false)  // Hide from API responses

  tenant Tenant @relation(fields: [tenantId], references: [id])
  job    Job    @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId], name: "idx_screening_questions_job")
  @@map("screening_questions")
}
```

Then regenerate Prisma client:
```bash
npx prisma generate
```

---

## 3. Create Config Module (1 hour)

### `src/config/config.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { ConfigService } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  async getConfig() {
    return this.configService.getConfig();
  }
}
```

### `src/config/config.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  getConfig() {
    return {
      departments: [
        'Engineering',
        'Product',
        'Design',
        'Marketing',
        'HR',
      ],
      hiring_managers: [
        { id: 'mgr-1', name: 'Jane Smith' },
        { id: 'mgr-2', name: 'Admin Cohen' },
      ],
      job_types: [
        { id: 'full_time', label: 'Full Time' },
        { id: 'part_time', label: 'Part Time' },
        { id: 'contract', label: 'Contract' },
      ],
      organization_types: [
        { id: 'startup', label: 'Startup' },
        { id: 'scale_up', label: 'Scale-up' },
        { id: 'enterprise', label: 'Enterprise' },
        { id: 'nonprofit', label: 'Nonprofit' },
        { id: 'government', label: 'Government' },
      ],
      screening_question_types: [
        { id: 'yes_no', label: 'Yes / No' },
        { id: 'text', label: 'Free Text' },
      ],
      hiring_stages_template: [
        {
          name: 'Application review',
          is_enabled: true,
          color: 'bg-zinc-400',
          is_custom: false,
          order: 1,
        },
        {
          name: 'Screening',
          is_enabled: true,
          color: 'bg-blue-500',
          is_custom: false,
          order: 2,
        },
        {
          name: 'Interview',
          is_enabled: true,
          color: 'bg-indigo-400',
          is_custom: false,
          order: 3,
        },
        {
          name: 'Offer',
          is_enabled: true,
          color: 'bg-emerald-500',
          is_custom: false,
          order: 4,
        },
      ],
    };
  }
}
```

### `src/config/config.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

@Module({
  controllers: [ConfigController],
  providers: [ConfigService],
})
export class ConfigModule {}
```

### Add to `src/app.module.ts`:
```typescript
import { ConfigModule as AppConfigModule } from './config/config.module';

@Module({
  imports: [
    // ... existing imports
    AppConfigModule,  // Add this
  ],
})
export class AppModule {}
```

---

## 4. Fix Jobs Endpoints (3-4 hours)

### Update DTO: `src/jobs/dto/create-job.dto.ts`

```typescript
import { z } from 'zod';

export const HiringStageCreateSchema = z.object({
  id: z.string().optional(),  // Temp client UUID
  name: z.string().min(1, 'Stage name required').max(255),
  order: z.number().int().min(1),
  interviewer: z.string().nullable().optional(),  // Changed: was responsibleUserId
  color: z.string().min(1),  // NEW
  is_enabled: z.boolean().default(true),  // NEW (only in request, API will convert)
  is_custom: z.boolean().default(false),
});

export const ScreeningQuestionCreateSchema = z.object({
  id: z.string().optional(),  // Temp client UUID
  text: z.string().min(1, 'Question text required'),
  type: z.enum(['yes_no', 'text']),  // Changed: was answerType
  expected_answer: z.string().nullable().optional(),  // NEW
  order: z.number().int().min(1).optional(),
});

export const CreateJobSchema = z.object({
  title: z.string().min(1, 'Job title required').max(255),
  department: z.string().optional(),
  location: z.string().optional(),
  job_type: z.string().default('full_time'),
  status: z.enum(['draft', 'open', 'closed']).default('draft'),
  hiring_manager: z.string().optional(),
  description: z.string().optional(),
  responsibilities: z.string().optional(),
  what_we_offer: z.string().optional(),
  salary_range: z.string().optional(),
  must_have_skills: z.array(z.string()).default([]),
  nice_to_have_skills: z.array(z.string()).default([]),
  min_experience: z.number().int().min(0).optional(),
  max_experience: z.number().int().min(0).optional(),
  selected_org_types: z.array(z.string()).default([]),
  screening_questions: z.array(ScreeningQuestionCreateSchema).optional(),
  hiring_flow: z.array(HiringStageCreateSchema),  // Required
}).refine(
  (data) => data.hiring_flow.some((s) => s.is_enabled),
  { message: 'At least one hiring stage must be enabled', path: ['hiring_flow'] }
);

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
```

### Update Service: `src/jobs/jobs.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CreateJobDto } from './dto/create-job.dto';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const tenantId = this.configService.get<string>('TENANT_ID')!;

    const jobs = await this.prisma.job.findMany({
      where: { tenantId },
      include: {
        hiringStages: { orderBy: { order: 'asc' } },
        screeningQuestions: { orderBy: { order: 'asc' } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to API response format (snake_case to camelCase conversion)
    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        department: job.department,
        location: job.location,
        job_type: job.jobType,
        status: job.status,
        hiring_manager: job.hiringManager,
        candidate_count: job._count.applications,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
        description: job.description,
        responsibilities: job.responsibilities,
        what_we_offer: job.whatWeOffer,
        salary_range: job.salaryRange,
        must_have_skills: job.mustHaveSkills,
        nice_to_have_skills: job.niceToHaveSkills,
        min_experience: job.expYearsMin,
        max_experience: job.expYearsMax,
        selected_org_types: job.preferredOrgTypes,
        screening_questions: job.screeningQuestions.map((q) => ({
          id: q.id,
          text: q.text,
          type: q.answerType,  // Convert answerType → type
          expected_answer: q.expectedAnswer,
        })),
        hiring_flow: job.hiringStages.map((s) => ({
          id: s.id,
          name: s.name,
          is_enabled: s.isEnabled,
          interviewer: s.interviewer,
          color: s.color,
          is_custom: s.isCustom,
          order: s.order,
        })),
      })),
      total: jobs.length,
    };
  }

  async createJob(dto: CreateJobDto) {
    const tenantId = this.configService.get<string>('TENANT_ID')!;

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          tenantId,
          title: dto.title,
          department: dto.department ?? null,
          location: dto.location ?? null,
          jobType: dto.job_type ?? 'full_time',
          status: dto.status ?? 'draft',
          hiringManager: dto.hiring_manager ?? null,
          description: dto.description ?? null,
          responsibilities: dto.responsibilities ?? null,
          whatWeOffer: dto.what_we_offer ?? null,
          salaryRange: dto.salary_range ?? null,
          mustHaveSkills: dto.must_have_skills ?? [],
          niceToHaveSkills: dto.nice_to_have_skills ?? [],
          expYearsMin: dto.min_experience ?? null,
          expYearsMax: dto.max_experience ?? null,
          preferredOrgTypes: dto.selected_org_types ?? [],
          hiringStages: {
            create: (dto.hiring_flow || []).map((stage) => ({
              tenantId,
              name: stage.name,
              order: stage.order,
              interviewer: stage.interviewer ?? null,
              color: stage.color,
              isEnabled: stage.is_enabled ?? true,
              isCustom: stage.is_custom ?? false,
            })),
          },
          screeningQuestions: {
            create: (dto.screening_questions || []).map((q, i) => ({
              tenantId,
              text: q.text,
              answerType: q.type,
              expectedAnswer: q.expected_answer ?? null,
              order: q.order ?? i + 1,
            })),
          },
        },
        include: {
          hiringStages: { orderBy: { order: 'asc' } },
          screeningQuestions: { orderBy: { order: 'asc' } },
          _count: { select: { applications: true } },
        },
      });

      return this._formatJobResponse(job);
    });
  }

  async updateJob(id: string, dto: CreateJobDto) {
    const tenantId = this.configService.get<string>('TENANT_ID')!;

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id, tenantId },
        data: {
          title: dto.title,
          department: dto.department ?? null,
          location: dto.location ?? null,
          jobType: dto.job_type ?? 'full_time',
          status: dto.status ?? 'draft',
          hiringManager: dto.hiring_manager ?? null,
          description: dto.description ?? null,
          responsibilities: dto.responsibilities ?? null,
          whatWeOffer: dto.what_we_offer ?? null,
          salaryRange: dto.salary_range ?? null,
          mustHaveSkills: dto.must_have_skills ?? [],
          niceToHaveSkills: dto.nice_to_have_skills ?? [],
          expYearsMin: dto.min_experience ?? null,
          expYearsMax: dto.max_experience ?? null,
          preferredOrgTypes: dto.selected_org_types ?? [],
          // Delete and recreate stages & questions
          hiringStages: {
            deleteMany: {},
            create: (dto.hiring_flow || []).map((stage) => ({
              tenantId,
              name: stage.name,
              order: stage.order,
              interviewer: stage.interviewer ?? null,
              color: stage.color,
              isEnabled: stage.is_enabled ?? true,
              isCustom: stage.is_custom ?? false,
            })),
          },
          screeningQuestions: {
            deleteMany: {},
            create: (dto.screening_questions || []).map((q, i) => ({
              tenantId,
              text: q.text,
              answerType: q.type,
              expectedAnswer: q.expected_answer ?? null,
              order: q.order ?? i + 1,
            })),
          },
        },
        include: {
          hiringStages: { orderBy: { order: 'asc' } },
          screeningQuestions: { orderBy: { order: 'asc' } },
          _count: { select: { applications: true } },
        },
      });

      return this._formatJobResponse(job);
    });
  }

  async deleteJob(id: string) {
    const tenantId = this.configService.get<string>('TENANT_ID')!;

    await this.prisma.job.delete({
      where: { id, tenantId },
    });
  }

  private _formatJobResponse(job: any) {
    return {
      id: job.id,
      title: job.title,
      department: job.department,
      location: job.location,
      job_type: job.jobType,
      status: job.status,
      hiring_manager: job.hiringManager,
      candidate_count: job._count.applications,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      description: job.description,
      responsibilities: job.responsibilities,
      what_we_offer: job.whatWeOffer,
      salary_range: job.salaryRange,
      must_have_skills: job.mustHaveSkills,
      nice_to_have_skills: job.niceToHaveSkills,
      min_experience: job.expYearsMin,
      max_experience: job.expYearsMax,
      selected_org_types: job.preferredOrgTypes,
      screening_questions: job.screeningQuestions.map((q: any) => ({
        id: q.id,
        text: q.text,
        type: q.answerType,
        expected_answer: q.expectedAnswer,
      })),
      hiring_flow: job.hiringStages.map((s: any) => ({
        id: s.id,
        name: s.name,
        is_enabled: s.isEnabled,
        interviewer: s.interviewer,
        color: s.color,
        is_custom: s.isCustom,
        order: s.order,
      })),
    };
  }
}
```

### Update Controller: `src/jobs/jobs.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobSchema } from './dto/create-job.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  async findAll() {
    return this.jobsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // Optional: get single job by ID
    return this.jobsService.findAll().then((res) =>
      res.jobs.find((j) => j.id === id) || null
    );
  }

  @Post()
  async create(@Body() body: unknown) {
    const result = CreateJobSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    return this.jobsService.createJob(result.data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const result = CreateJobSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    try {
      return await this.jobsService.updateJob(id, result.data);
    } catch (error: any) {
      if (error.code === 'P2025') {  // Prisma "not found"
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Job not found',
        });
      }
      throw error;
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      await this.jobsService.deleteJob(id);
      return { success: true };
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Job not found',
        });
      }
      throw error;
    }
  }
}
```

---

## 5. Implement Candidates Endpoint (1-2 hours)

**⚠️ Note:** This endpoint is preliminary and will change. For MVP, keep it simple.

### `src/candidates/candidates.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { CandidatesService } from './candidates.service';

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  async findAll(
    @Query('q') search?: string,
    @Query('filter') filter?: string,
  ) {
    return this.candidatesService.findAll({ search, filter });
  }
}
```

### `src/candidates/candidates.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(options: { search?: string; filter?: string } = {}) {
    const tenantId = this.configService.get<string>('TENANT_ID')!;

    let where: any = { tenantId };

    // Simple search on name, email, role
    if (options.search) {
      where.OR = [
        { fullName: { contains: options.search, mode: 'insensitive' } },
        { email: { contains: options.search, mode: 'insensitive' } },
        { currentRole: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    // TODO: Implement filter logic in Phase 2
    // Options: 'high-score', 'available', 'referred', 'duplicates'

    const candidates = await this.prisma.candidate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      candidates: candidates.map((c) => ({
        id: c.id,
        full_name: c.fullName,
        email: c.email,
        phone: c.phone,
        current_role: c.currentRole,
        location: c.location,
        cv_file_url: c.cvFileUrl,
        source: c.source,
        created_at: c.createdAt,
        ai_score: 0,  // TODO: Compute from CandidateJobScore
        is_duplicate: false,  // TODO: Check DuplicateFlag
        skills: c.skills,
      })),
      total: candidates.length,
    };
  }
}
```

---

## 6. Testing (2-3 hours)

### Minimal test suite:

```bash
npm test -- src/jobs/jobs.controller.spec.ts
npm test -- src/jobs/jobs.service.spec.ts
```

**Key tests:**
- ✅ GET /jobs returns nested hiring_flow & screening_questions
- ✅ POST /jobs creates with all fields
- ✅ PUT /jobs/:id updates correctly
- ✅ POST /jobs validates required fields
- ✅ At least one hiring stage must be enabled
- ✅ GET /config returns static response
- ✅ GET /candidates returns basic list

---

## 7. Validation Checklist

Before shipping:

- [ ] All fields in `API_PROTOCOL_MVP.md` response match exactly
- [ ] Field names use snake_case in JSON (job_type, not jobType)
- [ ] Nested arrays (hiring_flow, screening_questions) are ordered by `order`
- [ ] At least one hiring_stage has `is_enabled: true`
- [ ] `candidate_count` is accurate (count of applications)
- [ ] Error responses use correct format: `{ error: { code, message, details } }`
- [ ] Tenant isolation works (x-tenant-id filters all queries)
- [ ] Tests pass
- [ ] No SQL errors in logs

---

## Quick Commands

```bash
# Migrations
npm run migrate:dev

# Prisma studio (inspect DB)
npx prisma studio

# Tests
npm test

# Dev server
npm run start:dev

# Format code
npm run format
```

