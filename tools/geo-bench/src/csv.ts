/**
 * Minimal RFC 4180 CSV reader/writer (no dependency): quoted fields, doubled quotes, CR/LF/CRLF line ends, UTF-8 BOM.
 */

const BOM = String.fromCodePoint(0xfeff);

/** Parses CSV text into rows of fields. Throws on an unterminated quoted field. */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && input.charAt(i + 1) === '\n') i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialises rows as CSV with LF line ends. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((r) => r.map(escapeField).join(',')).join('\n')}\n`;
}
