import { toAdf } from './adf.util';

describe('toAdf', () => {
  it('converts plain text to paragraph nodes', () => {
    const result = toAdf('Hello world', []);
    expect(result.version).toBe(1);
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('paragraph');
    expect(result.content[0].content![0].text).toBe('Hello world');
  });

  it('splits on blank lines into multiple paragraphs', () => {
    const result = toAdf('First paragraph\n\nSecond paragraph', []);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].content![0].text).toBe('First paragraph');
    expect(result.content[1].content![0].text).toBe('Second paragraph');
  });

  it('appends heading + bullet list when acceptanceCriteria is non-empty', () => {
    const result = toAdf('Description', ['AC1', 'AC2']);
    expect(result.content).toHaveLength(3); // paragraph + heading + bulletList
    const heading = result.content[1];
    expect(heading.type).toBe('heading');
    expect(heading.content![0].text).toBe('Acceptance Criteria');
    const list = result.content[2];
    expect(list.type).toBe('bulletList');
    expect(list.content).toHaveLength(2);
    expect(list.content![0].type).toBe('listItem');
  });

  it('omits the list section when acceptanceCriteria is empty', () => {
    const result = toAdf('Just a description', []);
    const hasHeading = result.content.some((n) => n.type === 'heading');
    const hasList = result.content.some((n) => n.type === 'bulletList');
    expect(hasHeading).toBe(false);
    expect(hasList).toBe(false);
  });

  it('produces valid ADF doc shape', () => {
    const result = toAdf('desc', ['ac1']);
    expect(result).toMatchObject({ version: 1, type: 'doc' });
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('drops blank acceptance-criteria items (no empty text nodes)', () => {
    const result = toAdf('Description', ['Real criterion', '   ', '']);
    const list = result.content.find((n) => n.type === 'bulletList');
    expect(list!.content).toHaveLength(1);
  });

  it('omits the list entirely when every criterion is blank', () => {
    const result = toAdf('Description', ['', '  ']);
    expect(result.content.some((n) => n.type === 'bulletList')).toBe(false);
    expect(result.content.some((n) => n.type === 'heading')).toBe(false);
  });

  it('falls back to a single empty paragraph for an empty document', () => {
    const result = toAdf('   ', []);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('paragraph');
  });
});
