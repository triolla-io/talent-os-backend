// Integration test stubs for Phase 10/11 — backward compatibility and end-to-end POST /jobs
// Guards: Application.stage field, Job.description/requirements fields, no ScoringAgent coupling

import { JobsService } from './jobs.service';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 10/11 integration', () => {
  describe('backward compatibility', () => {
    it('D-01: Job.description field still exists and is readable after migration', () => {
      const serviceSource = fs.readFileSync(
        path.join(__dirname, 'jobs.service.ts'),
        'utf8',
      );
      expect(serviceSource).toContain('description');
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
    it('D-06: job created with hiring_flow and screening_questions in single operation', async () => {
      const mockJob = {
        id: 'job-1',
        title: 'Eng',
        tenantId: 't1',
        jobType: 'full_time',
        status: 'draft',
        department: null,
        location: null,
        hiringManager: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        responsibilities: null,
        whatWeOffer: null,
        salaryRange: null,
        mustHaveSkills: [],
        niceToHaveSkills: [],
        expYearsMin: null,
        expYearsMax: null,
        preferredOrgTypes: [],
        hiringStages: [{ id: 's1', name: 'Application Review', order: 1, isCustom: false, isEnabled: true, color: 'bg-zinc-400', interviewer: null }],
        screeningQuestions: [{ id: 'q1', text: 'Q?', answerType: 'yes_no', expectedAnswer: null }],
        _count: { applications: 0 },
      };
      const mockPrisma = {
        job: { create: jest.fn().mockResolvedValue(mockJob) },
        $transaction: jest.fn().mockImplementation((cb: (tx: any) => any) => cb({
          job: { create: jest.fn().mockResolvedValue(mockJob) },
        })),
      };
      const mockConfig = { get: jest.fn().mockReturnValue('t1') };
      const service = new JobsService(mockPrisma as any, mockConfig as any);
      const result = await service.createJob({
        title: 'Eng',
        job_type: 'full_time',
        status: 'draft',
        hiring_flow: [{ name: 'Application Review', order: 1, color: 'bg-zinc-400', is_enabled: true, is_custom: false }],
        screening_questions: [{ text: 'Q?', type: 'yes_no' }],
        must_have_skills: [],
        nice_to_have_skills: [],
        selected_org_types: [],
      });
      expect(result).toHaveProperty('hiring_flow');
      expect(result).toHaveProperty('screening_questions');
    });

    it('D-07: job created with default stages when hiring_flow omitted', async () => {
      const mockTx = {
        job: {
          create: jest
            .fn()
            .mockResolvedValue({
              id: 'job-1',
              title: 'Eng',
              jobType: 'full_time',
              status: 'draft',
              department: null,
              location: null,
              hiringManager: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              description: null,
              responsibilities: null,
              whatWeOffer: null,
              salaryRange: null,
              mustHaveSkills: [],
              niceToHaveSkills: [],
              expYearsMin: null,
              expYearsMax: null,
              preferredOrgTypes: [],
              hiringStages: [],
              screeningQuestions: [],
              _count: { applications: 0 },
            }),
        },
      };
      const mockPrisma = {
        $transaction: jest.fn().mockImplementation((cb: (tx: any) => any) => cb(mockTx)),
      };
      const mockConfig = { get: jest.fn().mockReturnValue('t1') };
      const service = new JobsService(mockPrisma as any, mockConfig as any);
      await service.createJob({
        title: 'Eng',
        job_type: 'full_time',
        status: 'draft',
        must_have_skills: [],
        nice_to_have_skills: [],
        selected_org_types: [],
      });
      const createArgs = mockTx.job.create.mock.calls[0][0];
      expect(createArgs.data.hiringStages.create).toHaveLength(4);
      expect(createArgs.data.hiringStages.create[0].name).toBe('Application Review');
      expect(createArgs.data.hiringStages.create[3].name).toBe('Offer');
    });
  });
});
