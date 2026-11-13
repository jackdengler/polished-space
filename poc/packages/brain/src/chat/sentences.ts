/**
 * Cuts a streamed reply into pieces for text-to-speech, as the text arrives.
 *
 * - The FIRST piece is cut early (at a comma, colon or dash once it has a few
 *   words, or at a word gap once it is long) so speech can start fast.
 * - Later pieces are whole sentences, cut at `.`, `!` or `?` followed by
 *   whitespace, skipping common abbreviations ("Dr.", "e.g.") and decimals.
 * - A very long run with no sentence end is cut at a comma or word gap.
 *
 * Pieces are contiguous slices of the input (whitespace included), so the
 * concatenation of everything `push` and `flush` return equals the input.
 * That lets the voice session map audio back to the exact text spoken.
 */

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie', 'approx', 'no', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export interface ChunkerOptions {
  /** First piece: cut at a comma/colon/dash once it is at least this long. Default 18. */
  firstMinChars?: number;
  /** First piece: cut at any word gap once it is this long. Default 60. */
  firstMaxChars?: number;
  /** Later pieces: cut at a comma or word gap once this long without a sentence end. Default 220. */
  maxChars?: number;
}

export class SentenceChunker {
  private buf = '';
  private emitted = 0;
  private readonly firstMin: number;
  private readonly firstMax: number;
  private readonly max: number;

  constructor(opts: ChunkerOptions = {}) {
    this.firstMin = opts.firstMinChars ?? 18;
    this.firstMax = opts.firstMaxChars ?? 60;
    this.max = opts.maxChars ?? 220;
  }

  /** Add streamed text; returns the pieces that are now complete. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut <= 0) break;
      // Every cut ends after visible text, so a piece is never whitespace only.
      out.push(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
      this.emitted++;
    }
    return out;
  }

  /** End of the reply: whatever is left (may be empty). */
  flush(): string {
    const rest = this.buf;
    this.buf = '';
    if (rest.trim()) this.emitted++;
    return rest;
  }

  /** Index just after the cut (including trailing whitespace), or -1. */
  private findCut(): number {
    const b = this.buf;
    // Sentence ends: [.!?] (+ closing quotes/brackets) followed by whitespace.
    const re = /[.!?]+["'”’)\]]*(\s+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const end = m.index + m[0].length;
      if (b[m.index] === '.' && this.isAbbreviation(b, m.index)) continue;
      return end;
    }
    // Hard line breaks end a piece too (lists, paragraphs).
    const nl = b.search(/\n\s*/);
    if (nl > 0 && b.slice(0, nl).trim()) {
      const after = /\n\s*/.exec(b.slice(nl))![0].length;
      if (nl + after < b.length) return nl + after;
    }
    if (this.emitted === 0) {
      if (b.length >= this.firstMin) {
        const soft = /[,;:–—]\s+/g;
        let s: RegExpExecArray | null;
        while ((s = soft.exec(b))) {
          if (s.index + 1 >= this.firstMin) return s.index + s[0].length;
        }
      }
      if (b.length >= this.firstMax) return this.wordGapBefore(b, this.firstMax);
      return -1;
    }
    if (b.length >= this.max) {
      const soft = b.slice(0, this.max).search(/[,;:]\s+[^,;:]*$/);
      if (soft > this.max / 3) return soft + /[,;:]\s+/.exec(b.slice(soft))![0].length;
      return this.wordGapBefore(b, this.max);
    }
    return -1;
  }

  private wordGapBefore(b: string, limit: number): number {
    const head = b.slice(0, limit + 1);
    const gap = head.search(/\s+\S*$/);
    if (gap <= 0) return -1;
    return gap + /\s+/.exec(head.slice(gap))![0].length;
  }

  private isAbbreviation(b: string, dot: number): boolean {
    const word = /([A-Za-z.]+)$/.exec(b.slice(0, dot))?.[1] ?? '';
    const bare = word.replace(/\./g, '').toLowerCase();
    if (ABBREVIATIONS.has(bare)) return true;
    // Single initials ("J. Smith") but not the pronoun "I".
    return /^[A-Z]$/.test(word) && word !== 'I';
  }
}

/** Light clean-up so the voice does not read markdown symbols aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)[#>]+\s*/g, '$1')
    .replace(/(^|\n)\s*(?:[-*•]|\d+[.)])\s+/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/[*_~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
