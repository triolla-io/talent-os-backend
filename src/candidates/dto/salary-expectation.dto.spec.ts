import { CreateCandidateSchema } from './create-candidate.dto';
import { UpdateCandidateSchema } from './update-candidate.dto';

const baseCreate = {
  full_name: 'Jane',
  source: 'manual',
  job_id: '11111111-1111-1111-1111-111111111111',
};

describe('salary expectation validation', () => {
  it('accepts a valid min/max range on create', () => {
    const r = CreateCandidateSchema.parse({ ...baseCreate, salary_expectation_min: 10000, salary_expectation_max: 15000 });
    expect(r.salary_expectation_min).toBe(10000);
    expect(r.salary_expectation_max).toBe(15000);
  });

  it('accepts omitted salary fields (optional)', () => {
    const r = CreateCandidateSchema.parse({ ...baseCreate });
    expect(r.salary_expectation_min ?? null).toBeNull();
    expect(r.salary_expectation_max ?? null).toBeNull();
  });

  it('accepts only one bound', () => {
    expect(() => UpdateCandidateSchema.parse({ salary_expectation_min: 12000 })).not.toThrow();
    expect(() => UpdateCandidateSchema.parse({ salary_expectation_max: 12000 })).not.toThrow();
  });

  it('accepts null to clear a bound on update', () => {
    const r = UpdateCandidateSchema.parse({ salary_expectation_min: null });
    expect(r.salary_expectation_min).toBeNull();
  });

  it('rejects min > max on create', () => {
    expect(() => CreateCandidateSchema.parse({ ...baseCreate, salary_expectation_min: 20000, salary_expectation_max: 10000 })).toThrow();
  });

  it('rejects min > max on update', () => {
    expect(() => UpdateCandidateSchema.parse({ salary_expectation_min: 20000, salary_expectation_max: 10000 })).toThrow();
  });

  it('rejects negative salary', () => {
    expect(() => UpdateCandidateSchema.parse({ salary_expectation_min: -5 })).toThrow();
  });
});
