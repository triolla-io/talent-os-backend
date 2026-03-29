import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JobTitleMatcherService, JobTitleMatchResult } from './job-title-matcher.service';

jest.mock('@openrouter/sdk', () => ({
  OpenRouter: jest.fn(),
}));

import { OpenRouter } from '@openrouter/sdk';

describe('JobTitleMatcherService', () => {
  let service: JobTitleMatcherService;
  let configService: ConfigService;
  let mockOpenRouter: jest.Mocked<OpenRouter>;

  beforeEach(async () => {
    mockOpenRouter = {
      callModel: jest.fn(),
    } as unknown as jest.Mocked<OpenRouter>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobTitleMatcherService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OPENROUTER_API_KEY') return 'test-api-key';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<JobTitleMatcherService>(JobTitleMatcherService);
    configService = module.get<ConfigService>(ConfigService);
    (OpenRouter as jest.Mock).mockReturnValue(mockOpenRouter);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('matchJobTitles', () => {
    // Test 1: Similar roles with seniority variation
    it('should match "Software Developer" and "Senior Software Engineer" with high confidence', async () => {
      const mockResponse = {
        getText: jest.fn().mockResolvedValueOnce(
          JSON.stringify({
            matched: true,
            confidence: 92,
            reasoning: 'Both refer to software engineer roles; seniority differs but core skill set is the same',
          })
        ),
      };
      mockOpenRouter.callModel.mockReturnValueOnce(mockResponse as any);

      const result = await service.matchJobTitles(
        'Software Developer',
        'Senior Software Engineer',
        'tenant-1'
      );

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.85);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
      expect(result.reasoning).toBeDefined();
    });

    // Test 2: Similar frontend specializations
    it('should match "Frontend Engineer" and "Senior Frontend Engineer" with high confidence', async () => {
      const mockResponse = {
        getText: jest.fn().mockResolvedValueOnce(
          JSON.stringify({
            matched: true,
            confidence: 95,
            reasoning: 'Both are frontend engineering roles; seniority level is the only difference',
          })
        ),
      };
      mockOpenRouter.callModel.mockReturnValueOnce(mockResponse as any);

      const result = await service.matchJobTitles(
        'Frontend Engineer',
        'Senior Frontend Engineer',
        'tenant-1'
      );

      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.90);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    // Test 3: Unrelated roles
    it('should NOT match "Data Analyst" and "Software Developer"', async () => {
      const mockResponse = {
        getText: jest.fn().mockResolvedValueOnce(
          JSON.stringify({
            matched: false,
            confidence: 15,
            reasoning: 'Data Analyst focuses on data analysis; Software Developer focuses on software engineering',
          })
        ),
      };
      mockOpenRouter.callModel.mockReturnValueOnce(mockResponse as any);

      const result = await service.matchJobTitles(
        'Data Analyst',
        'Software Developer',
        'tenant-1'
      );

      expect(result.matched).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    // Test 4: Completely different domains
    it('should NOT match "Product Manager" and "DevOps Engineer"', async () => {
      const mockResponse = {
        getText: jest.fn().mockResolvedValueOnce(
          JSON.stringify({
            matched: false,
            confidence: 5,
            reasoning: 'Product Manager is a business/product role; DevOps Engineer is an infrastructure role',
          })
        ),
      };
      mockOpenRouter.callModel.mockReturnValueOnce(mockResponse as any);

      const result = await service.matchJobTitles(
        'Product Manager',
        'DevOps Engineer',
        'tenant-1'
      );

      expect(result.matched).toBe(false);
      expect(result.confidence).toBeLessThan(0.3);
    });

    // Test 5: Graceful fallback on error
    it('should handle network errors gracefully', async () => {
      const mockResponse = {
        getText: jest.fn().mockRejectedValueOnce(
          new Error('Service unavailable')
        ),
      };
      mockOpenRouter.callModel.mockReturnValueOnce(mockResponse as any);

      const result = await service.matchJobTitles(
        'Software Developer',
        'Senior Software Engineer',
        'tenant-1'
      );

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.error).toBeDefined();
    });

    // Test 6: Empty or null input handling
    it('should handle empty or null inputs safely', async () => {
      const result1 = await service.matchJobTitles('', '', 'tenant-1');
      expect(result1.matched).toBe(false);
      expect(result1.confidence).toBe(0);

      const result2 = await service.matchJobTitles('Software Developer', '', 'tenant-1');
      expect(result2.matched).toBe(false);
      expect(result2.confidence).toBe(0);
    });
  });
});
