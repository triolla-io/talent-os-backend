/**
 * Strip characters that PostgreSQL `text`/`varchar` columns cannot store, so any
 * text extracted from CVs (PDF/DOCX) or email bodies can always be persisted.
 *
 * Postgres rejects:
 *   - NUL bytes (U+0000)              → "invalid byte sequence" / 22021
 *   - lone/unpaired UTF-16 surrogates → invalid UTF-8 on encode
 *
 * pdf-parse and mammoth occasionally emit both (font/encoding quirks). Before this
 * guard existed, such a character in `cv_text` made the Phase 7 enrichment update
 * throw, leaving the candidate as a bare shell with no CV or enriched data.
 *
 * The operation is idempotent — safe to apply at multiple layers (defense in depth).
 */
export function sanitizePgText(input: string): string {
  return (
    input
      // strip NUL (U+0000) — built from a char code to keep the source free of control bytes
      .split(String.fromCharCode(0))
      .join('')
      // unpaired high surrogate (not followed by a low surrogate)
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      // unpaired low surrogate (not preceded by a high surrogate)
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  );
}
