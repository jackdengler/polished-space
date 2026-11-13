import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pdfText, textFromContentStream } from './pdfText';

const pdf = (streams: { data: Buffer; flate?: boolean }[]) => {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')];
  streams.forEach((s, i) => {
    parts.push(Buffer.from(`${i + 2} 0 obj\n<< /Length ${s.data.length}${s.flate ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'), s.data, Buffer.from('\nendstream\nendobj\n'));
  });
  return Buffer.concat(parts);
};

describe('pdfText', () => {
  it('reads Tj, TJ and quote operators, with escapes and line breaks', () => {
    const t = textFromContentStream("BT /F1 11 Tf 15 TL 56 736 Td (Driver Pay \\(Draft\\)) Tj T* [(Coastal: ) -20 (+6%)] TJ (Inland: -3%) ' ET");
    expect(t.split('\n')).toEqual(['Driver Pay (Draft)', 'Coastal: +6%', 'Inland: -3%']);
  });

  it('handles plain and FlateDecode content streams', () => {
    const plain = Buffer.from('BT (Summary) Tj T* (Bands for linehaul drivers.) Tj ET', 'latin1');
    const packed = deflateSync(Buffer.from('BT (Next steps) Tj ET', 'latin1'));
    expect(pdfText(pdf([{ data: plain }, { data: packed, flate: true }]))).toBe('Summary\nBands for linehaul drivers.\n\nNext steps');
  });

  it('returns an empty string when there is no text', () => {
    expect(pdfText(Buffer.from('%PDF-1.4\n%%EOF'))).toBe('');
  });
});
