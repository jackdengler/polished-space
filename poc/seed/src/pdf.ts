/**
 * A tiny, dependency-free PDF writer: one or more pages of plain text in
 * Helvetica. Enough to give the fake file server real PDFs that Claude can
 * read as document blocks. ASCII text only.
 */

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 56;
const LEADING = 15;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING) - 2;

function esc(s: string): string {
  if (/[^\x20-\x7e]/.test(s)) throw new Error(`PDF text must be printable ASCII: ${JSON.stringify(s)}`);
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Wrap a paragraph to about `width` characters. */
function wrap(text: string, width = 88): string[] {
  if (text === '') return [''];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  out.push(line);
  return out;
}

/**
 * Build a PDF. `title` is drawn in bold on page 1; each entry of `lines` is a
 * paragraph (wrapped), `''` is a blank line, and lines starting with `# ` are
 * bold headings.
 */
export function makePdf(title: string, lines: string[]): Uint8Array {
  const rows: { text: string; bold: boolean }[] = [{ text: title, bold: true }, { text: '', bold: false }];
  for (const l of lines) {
    if (l.startsWith('# ')) rows.push({ text: l.slice(2), bold: true });
    else for (const w of wrap(l)) rows.push({ text: w, bold: false });
  }
  const pages: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += LINES_PER_PAGE) pages.push(rows.slice(i, i + LINES_PER_PAGE));

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((page, i) => {
    const ops = [`BT ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN} Td`];
    for (const r of page) ops.push(`/${r.bold ? 'F2' : 'F1'} ${r.bold ? 12 : 10.5} Tf (${esc(r.text)}) Tj T*`);
    ops.push('ET');
    const stream = ops.join('\n');
    const pageId = pageIds[i]!;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
