import { CreateJobSchema, HiringStageCreateSchema, ScreeningQuestionCreateSchema } from './create-job.dto';

describe('CreateJobSchema', () => {
  it('accepts { title: "Eng" } — title is the only required field', () => {
    const result = CreateJobSchema.parse({ title: 'Eng' });
    expect(result.title).toBe('Eng');
  });

  it('throws ZodError when title is missing', () => {
    expect(() => CreateJobSchema.parse({})).toThrow();
  });

  it('throws ZodError with "Job title required" when title is empty string', () => {
    expect(() => CreateJobSchema.parse({ title: '' })).toThrow('Job title required');
  });

  it('accepts hiringStages array with name and order', () => {
    const result = CreateJobSchema.parse({
      title: 'Eng',
      hiringStages: [{ name: 'Review', order: 1 }],
    });
    expect(result.hiringStages).toHaveLength(1);
    expect(result.hiringStages![0].name).toBe('Review');
  });

  it('accepts screeningQuestions with valid answerType', () => {
    const result = CreateJobSchema.parse({
      title: 'Eng',
      screeningQuestions: [{ text: 'Q?', answerType: 'yes_no' }],
    });
    expect(result.screeningQuestions).toHaveLength(1);
  });

  it('throws ZodError for invalid answerType', () => {
    expect(() =>
      CreateJobSchema.parse({
        title: 'Eng',
        screeningQuestions: [{ text: 'Q?', answerType: 'invalid' }],
      }),
    ).toThrow();
  });

  it('inferred type has hiringStages as optional array', () => {
    const result = CreateJobSchema.parse({ title: 'Eng' });
    expect(result.hiringStages).toBeUndefined();
  });

  it('inferred type has requirements defaulting to []', () => {
    const result = CreateJobSchema.parse({ title: 'Eng' });
    expect(result.requirements).toEqual([]);
  });
});

describe('HiringStageCreateSchema', () => {
  it('accepts name + order', () => {
    const result = HiringStageCreateSchema.parse({ name: 'Review', order: 1 });
    expect(result.name).toBe('Review');
    expect(result.isCustom).toBe(false);
  });

  it('accepts nullable responsibleUserId', () => {
    const result = HiringStageCreateSchema.parse({ name: 'Review', order: 1, responsibleUserId: null });
    expect(result.responsibleUserId).toBeNull();
  });

  it('accepts free text string for responsibleUserId (not UUID-validated)', () => {
    const result = HiringStageCreateSchema.parse({ name: 'Review', order: 1, responsibleUserId: 'John Smith (not a UUID)' });
    expect(result.responsibleUserId).toBe('John Smith (not a UUID)');
  });
});

describe('ScreeningQuestionCreateSchema', () => {
  it('accepts all valid answerType values', () => {
    for (const answerType of ['yes_no', 'text', 'multiple_choice', 'file_upload']) {
      expect(() =>
        ScreeningQuestionCreateSchema.parse({ text: 'Q?', answerType }),
      ).not.toThrow();
    }
  });

  it('rejects invalid answerType', () => {
    expect(() =>
      ScreeningQuestionCreateSchema.parse({ text: 'Q?', answerType: 'invalid' }),
    ).toThrow();
  });
});
