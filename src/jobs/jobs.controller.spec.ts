import { BadRequestException } from '@nestjs/common';
import { JobsController } from './jobs.controller';

describe('JobsController', () => {
  const mockJobsService = {
    findAll: jest.fn(),
    createJob: jest.fn(),
  };

  let controller: JobsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new JobsController(mockJobsService as any);
  });

  describe('POST /jobs', () => {
    it('D-06: calls jobsService.createJob with validated dto', async () => {
      mockJobsService.createJob.mockResolvedValue({ id: 'job-1', title: 'Software Engineer' });
      await controller.create({ title: 'Software Engineer' });
      expect(mockJobsService.createJob).toHaveBeenCalledTimes(1);
      expect(mockJobsService.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Software Engineer' }),
      );
    });

    it('D-08: returns 400 when title is missing', async () => {
      await expect(controller.create({})).rejects.toThrow(BadRequestException);
      try {
        await controller.create({});
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).message).toContain('Validation failed');
      }
    });

    it('D-08: returns 400 when answerType is invalid enum value', async () => {
      await expect(
        controller.create({
          title: 'Eng',
          screeningQuestions: [{ text: 'Q?', answerType: 'invalid_type' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('D-08: returns 201 with created job on valid payload', async () => {
      mockJobsService.createJob.mockResolvedValue({ id: 'job-1', title: 'Eng' });
      const result = await controller.create({ title: 'Eng' });
      expect(result).toEqual({ id: 'job-1', title: 'Eng' });
    });
  });
});
