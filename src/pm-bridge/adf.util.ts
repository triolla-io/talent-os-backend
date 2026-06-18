export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: { type: string }[];
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

function textNode(text: string): AdfNode {
  return { type: 'text', text };
}

function paragraph(text: string): AdfNode {
  return { type: 'paragraph', content: [textNode(text)] };
}

export function toAdf(description: string, acceptanceCriteria: string[]): AdfDoc {
  const content: AdfNode[] = description
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(paragraph);

  // Drop blank criteria — an empty string would produce an ADF text node with empty `text`,
  // which Jira rejects.
  const criteria = acceptanceCriteria.map((item) => item.trim()).filter(Boolean);
  if (criteria.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [textNode('Acceptance Criteria')],
    });
    content.push({
      type: 'bulletList',
      content: criteria.map((item) => ({
        type: 'listItem',
        content: [paragraph(item)],
      })),
    });
  }

  // ADF requires a non-empty doc; an all-blank description with no criteria would otherwise
  // yield `content: []`, which Jira rejects. Fall back to a single empty paragraph.
  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }

  return { version: 1, type: 'doc', content };
}
