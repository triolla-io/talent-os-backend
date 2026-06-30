import { formatSummaryBullets } from './candidate-ai.service';

describe('formatSummaryBullets', () => {
  it('strips mixed leading glyphs and numbering, joins clean lines with newlines', () => {
    const raw = [
      '• Senior backend engineer, 8 years',
      '- Led a 5-person payments team',
      '1. Shipped Stripe migration',
      '2) Expert in Node.js and Postgres',
      '* Mentors junior developers',
    ].join('\n');

    expect(formatSummaryBullets(raw)).toBe(
      [
        'Senior backend engineer, 8 years',
        'Led a 5-person payments team',
        'Shipped Stripe migration',
        'Expert in Node.js and Postgres',
        'Mentors junior developers',
      ].join('\n'),
    );
  });

  it('caps output at 5 lines', () => {
    const raw = Array.from({ length: 8 }, (_, i) => `Fact ${i + 1}`).join('\n');
    const out = formatSummaryBullets(raw);

    expect(out.split('\n')).toHaveLength(5);
    expect(out.split('\n')).toEqual(['Fact 1', 'Fact 2', 'Fact 3', 'Fact 4', 'Fact 5']);
  });

  it('drops blank and whitespace-only lines', () => {
    const raw = 'First fact\n\n   \nSecond fact\n';
    expect(formatSummaryBullets(raw)).toBe('First fact\nSecond fact');
  });

  it('returns empty string for blank / whitespace-only input', () => {
    expect(formatSummaryBullets('')).toBe('');
    expect(formatSummaryBullets('   \n  \n')).toBe('');
  });

  it('returns a single clean line for single-line input', () => {
    expect(formatSummaryBullets('- Just one fact')).toBe('Just one fact');
  });
});
