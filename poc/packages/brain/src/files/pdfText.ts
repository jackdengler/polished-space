/**
 * Plain-text extraction from a PDF, enough to SHOW a client file next to its
 * review (the review itself sends the whole PDF to Claude as a document
 * block). Reads each content stream (uncompressed or FlateDecode), takes the
 * strings drawn by Tj / TJ / ' / " and starts a new line on T*, Td, TD, Tm
 * and the quote operators. Layout, fonts with custom encodings and images
 * are not handled; the sidebar labels the result "text taken from the PDF".
 */
import { inflateSync } from 'node:zlib';

function decodePdfString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += '';
    else if (n === '\n' || n === '\r') {
      if (n === '\r' && raw[i + 1] === '\n') i++;
    } else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

/** Text drawn by one content stream. */
export function textFromContentStream(src: string): string {
  const lines: string[] = [];
  let line = '';
  const newline = () => {
    lines.push(line);
    line = '';
  };
  let i = 0;
  let operands: string[] = [];
  while (i < src.length) {
    const c = src[i]!;
    if (c === '(') {
      // Literal string with balanced parentheses and escapes.
      let depth = 1;
      let j = i + 1;
      let raw = '';
      while (j < src.length && depth > 0) {
        const d = src[j]!;
        if (d === '\\') {
          raw += d + (src[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (d === '(') depth++;
        else if (d === ')') depth--;
        if (depth > 0) raw += d;
        j++;
      }
      operands.push(decodePdfString(raw));
      i = j;
      continue;
    }
    if (c === '[' || c === ']' || /\s/.test(c)) {
      i++;
      continue;
    }
    const m = /^[A-Za-z'"*]+/.exec(src.slice(i, i + 4));
    if (m) {
      const op = m[0];
      i += op.length;
      if (op === 'Tj' || op === 'TJ') line += operands.join('');
      else if (op === "'" || op === '"') {
        newline();
        line += operands.slice(-1).join('');
      } else if (op === 'T*' || op === 'Td' || op === 'TD' || op === 'Tm' || op === 'ET') {
        if (line) newline();
      }
      operands = [];
      continue;
    }
    // Numbers, names, hex strings and anything else: skip one token.
    const t = /^\S+/.exec(src.slice(i))![0];
    i += Math.max(1, t.replace(/[()[\]].*$/, '').length);
  }
  if (line) newline();
  return lines.join('\n');
}

/** All text in a PDF, page content streams in file order. Empty string when none is found. */
export function pdfText(bytes: Buffer): string {
  const bin = bytes.toString('latin1');
  const parts: string[] = [];
  const re = /<<(.*?)>>\s*stream\r?\n/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    const dict = m[1]!;
    const start = m.index + m[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end;
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject|\/Length1|\/FontFile/.test(dict)) continue;
    let data = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    const text = textFromContentStream(data.toString('latin1')).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n').replace(/[ \t]+\n/g, '\n');
}
