import { describe, expect, it } from 'vitest';
import { SentenceChunker, speakable } from './sentences';

/** Feed text in small deltas (like a stream) and collect every piece. */
function run(text: string, step = 3, opts?: ConstructorParameters<typeof SentenceChunker>[0]): string[] {
  const c = new SentenceChunker(opts);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) out.push(...c.push(text.slice(i, i + step)));
  const rest = c.flush();
  if (rest) out.push(rest);
  return out;
}

describe('SentenceChunker', () => {
  it('cuts the first piece short (at a comma) and the rest at sentence ends', () => {
    const pieces = run("Sure, I've suggested a task, to chase Michael on Friday. It is tagged to Acme Tooling. Approve it when you're ready!");
    expect(pieces).toEqual(["Sure, I've suggested a task, ", 'to chase Michael on Friday. ', 'It is tagged to Acme Tooling. ', "Approve it when you're ready!"]);
  });

  it('a short first sentence is its own piece', () => {
    expect(run('Done. Anything else?')).toEqual(['Done. ', 'Anything else?']);
  });

  it('pieces always concatenate back to the input, whatever the delta size', () => {
    const text = 'Okay, here is the plan: first the pricing summary, then Lena\'s file.\nAfter that, lunch at 12:30. Dr. Vance (Harborlight) wants 3.5 hours on e.g. the driver pay draft? Yes!  Then we wrap up';
    for (const step of [1, 2, 5, 17, 1000]) expect(run(text, step).join('')).toBe(text);
  });

  it('does not cut at abbreviations, initials or decimals', () => {
    const pieces = run('Okay. Dr. Vance sent v2.5 of the file, e.g. the levels. Michael J. Okafor agreed. ');
    expect(pieces).toEqual(['Okay. ', 'Dr. Vance sent v2.5 of the file, e.g. the levels. ', 'Michael J. Okafor agreed. ']);
  });

  it('cuts a long first run with no punctuation at a word gap', () => {
    const text = 'so the thing I would look at first today is the market pricing summary for acme before your call';
    const pieces = run(text, 4);
    expect(pieces[0]!.length).toBeLessThanOrEqual(61);
    expect(pieces[0]).toMatch(/\s$/);
    expect(pieces.join('')).toBe(text);
  });

  it('cuts very long later sentences at a comma or word gap', () => {
    const long = `${'word '.repeat(60)}end.`;
    const pieces = run(`Okay. ${long}`, 7, { maxChars: 100 });
    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(101);
  });

  it('ends a piece at a line break', () => {
    expect(run('Two things:\n- the summary\n- the call')).toEqual(['Two things:\n', '- the summary\n', '- the call']);
  });

  it('nothing is emitted until there is a cut; flush returns the rest', () => {
    const c = new SentenceChunker();
    expect(c.push('Hello the')).toEqual([]);
    expect(c.push('re. How ')).toEqual(['Hello there. ']);
    expect(c.flush()).toBe('How ');
    expect(c.flush()).toBe('');
  });
});

describe('speakable', () => {
  it('strips markdown the voice would read out', () => {
    expect(speakable('**Done.** See `Acme` [file](http://x.example/a)')).toBe('Done. See Acme file');
    expect(speakable('- first item\n- second item')).toBe('first item second item');
    expect(speakable('## Heading\n1. one')).toBe('Heading one');
  });
});
