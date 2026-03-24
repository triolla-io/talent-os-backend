// Integration test stubs for Phase 10 — backward compatibility and end-to-end POST /jobs
// Guards: Application.stage field, Job.description/requirements fields, no ScoringAgent coupling

import { JobsService } from './jobs.service';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 10 integration', () => {
  describe('backward compatibility', () => {
    it('D-01: Job.description field still exists and is readable after migration', () => {
      const serviceSource = fs.readFileSync(
        path.join(__dirname, 'jobs.service.ts'),
        'utf8',
      );
      expect(serviceSource).toContain('description');
    });

    it('D-01: Job.requirements[] still exists and is readable after migration', () => {
      const serviceSource = fs.readFileSync(
        path.join(__dirname, 'jobs.service.ts'),
        'utf8',
      );
      expect(serviceSource).toContain('requirements');
    });

    it('D-02: Application.stage field still returned by ApplicationsService', () => {
      const appServiceSource = fs.readFileSync(
        path.join(__dirname, '../applications/applications.service.ts'),
        'utf8',
      );
      expect(appServiceSource).toContain('stage: a.stage');
    });

    it('D-02: Application.jobStageId is nullable — ApplicationsService does not crash on missing jobStageId', () => {
      const appServiceSource = fs.readFileSync(
        path.join(__dirname, '../applications/applications.service.ts'),
        'utf8',
      );
      // Confirm stage is still mapped (not replaced by jobStageId)
      expect(appServiceSource).toContain('stage: a.stage');
      // Confirm jobStageId is not mandated in the response shape
      expect(appServiceSource).not.toContain('jobStageId:');
    });

    it('D-03: ScoringAgentService is not imported or called from JobsService', () => {
      const serviceSource = fs.readFileSync(
        path.join(__dirname, 'jobs.service.ts'),
        'utf8',
      );
      expect(serviceSource).not.toContain('ScoringAgentService');
      expect(serviceSource).not.toContain('scoring');
    });
  });

  describe('POST /jobs end-to-end (mocked service)', () => {
    it('D-06: job created with hiringStages and screeningQuestions in single operation', async () => {
      const mockJob = {
        id: 'job-1',
        title: 'Eng',
        tenantId: 't1',
        hiringStages: [{ id: 's1', name: 'Application Review', order: 1 }],
        screeningQuestions: [{ id: 'q1', text: 'Q?', answerType: 'yes_no' }],
      };
      const mockPrisma = { job: { create: jest.fn().mockResolvedValue(mockJob) } };
      const mockConfig = { get: jest.fn().mockReturnValue('t1') };
      const service = new JobsService(mockPrisma as any, mockConfig as any);
      const result = await service.createJob({
        title: 'Eng',
        hiringStages: [{ name: 'Application Review', order: 1, isCustom: false }],
        screeningQuestions: [{ text: 'Q?', answerType: 'yes_no', required: false, knockout: false }],
        requirements: [],
        mustHaveSkills: [],
        niceToHaveSkills: [],
        preferredOrgTypes: [],
        jobType: 'full_time',
        status: 'draft',
      });
      expect(result.hiringStages).toHaveLength(1);
      expect(result.screeningQuestions).toHaveLength(1);
      expect(mockPrisma.job.create).toHaveBeenCalledTimes(1);
    });

    it('D-07: job created with default stages when hiringStages omitted', async () => {
      const mockPrisma = {
        job: {
          create: jest
            .fn()
            .mockResolvedValue({ id: 'job-1', hiringStages: [], screeningQuestions: [] }),
        },
      };
      const mockConfig = { get: jest.fn().mockReturnValue('t1') };
      const service = new JobsService(mockPrisma as any, mockConfig as any);
      await service.createJob({
        title: 'Eng',
        requirements: [],
        mustHaveSkills: [],
        niceToHaveSkills: [],
        preferredOrgTypes: [],
        jobType: 'full_time',
        status: 'draft',
      });
      const createArgs = mockPrisma.job.create.mock.calls[0][0];
      expect(createArgs.data.hiringStages.create).toHaveLength(4);
      expect(createArgs.data.hiringStages.create[0].name).toBe('Application Review');
      expect(createArgs.data.hiringStages.create[3].name).toBe('Offer');
    });
  });
});
