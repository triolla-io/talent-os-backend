import { sanitizePgText } from './sanitize-pg-text';

const NUL = String.fromCharCode(0);

describe('sanitizePgText', () => {
  it('strips a NUL (U+0000) byte that Postgres text columns reject', () => {
    expect(sanitizePgText(`Daniel${NUL}Amar`)).toBe('DanielAmar');
  });

  it('strips multiple NUL bytes', () => {
    expect(sanitizePgText(`${NUL}a${NUL}b${NUL}`)).toBe('ab');
  });

  it('strips an unpaired high surrogate', () => {
    expect(sanitizePgText('ok\uD800end')).toBe('okend');
  });

  it('strips an unpaired low surrogate', () => {
    expect(sanitizePgText('ok\uDC00end')).toBe('okend');
  });

  it('preserves a valid surrogate pair (emoji)', () => {
    expect(sanitizePgText('hi 😀 there')).toBe('hi 😀 there');
  });

  it('preserves normal Hebrew and English text', () => {
    expect(sanitizePgText('דניאל עמר — Beer Sheva')).toBe('דניאל עמר — Beer Sheva');
  });

  it('returns an empty string unchanged', () => {
    expect(sanitizePgText('')).toBe('');
  });
});
