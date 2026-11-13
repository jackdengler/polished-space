import { describe, expect, it } from 'vitest';
import { parseProfile, renderProfile } from '@poc/contracts';
import { applyProfileEdits, sectionBullets } from './edit';

const AT = '2026-11-13T13:47:00.000Z';
const opts = { clientName: 'Acme Tooling Co.', at: AT, sourceLabel: 'Email from Michael Okafor: Market pricing' };
const base = () =>
  renderProfile('Acme Tooling Co.', {
    'Also known as': ['Acme', 'ATC'],
    'Key contacts': ['Michael Okafor (VP HR): sponsor'],
    'Active projects': ['Market pricing analysis: summary draft in progress'],
    'Commitments: we owe': ['Revised SOW to Lena (overdue)'],
  });

describe('applyProfileEdits', () => {
  it('puts each op under the right heading and logs it with a date and the source', () => {
    const out = applyProfileEdits(
      base(),
      [
        { section: 'Commitments: we owe', op: 'add', text: 'Pricing update to Michael' },
        { section: 'Active projects', op: 'replace', text: 'Market pricing analysis: summary sent for review' },
        { section: 'Commitments: we owe', op: 'remove', text: 'Revised SOW to Lena (overdue)' },
        { section: 'Preferences and quirks', op: 'add', text: 'Michael prefers calls on Mondays' },
      ],
      opts,
    );
    expect(out.applied).toHaveLength(4);
    const md = out.markdown;
    expect(sectionBullets(md, 'Commitments: we owe')).toEqual(['Pricing update to Michael']);
    expect(sectionBullets(md, 'Active projects')).toEqual(['Market pricing analysis: summary sent for review']);
    expect(sectionBullets(md, 'Preferences and quirks')).toEqual(['Michael prefers calls on Mondays']);
    expect(md).not.toMatch(/## Preferences and quirks\n\n- \(none yet\)/);
    const log = sectionBullets(md, 'Change log');
    expect(log).toHaveLength(4);
    for (const l of log) {
      expect(l.startsWith(`${AT}: `)).toBe(true);
      expect(l).toContain('(source: Email from Michael Okafor: Market pricing)');
    }
    expect(log[1]).toContain('(was "Market pricing analysis: summary draft in progress")');
    // Untouched sections are byte-identical.
    expect(parseProfile(md).sections['Key contacts']).toBe(parseProfile(base()).sections['Key contacts']);
  });

  it('rejects unknown sections and malformed edits safely, and still applies the good ones', () => {
    const before = base();
    const out = applyProfileEdits(
      before,
      [
        { section: 'Change log', op: 'add', text: 'forged entry' },
        { section: 'Secret plans', op: 'add', text: 'x' },
        { section: 'Recent decisions', op: 'rewrite', text: 'x' },
        { section: 'Recent decisions', op: 'add', text: '   ' },
        { section: 'Recent decisions', op: 'add' },
        'not an object',
        null,
        { section: 'Recent decisions', op: 'add', text: 'Use a 1 January effective date' },
      ],
      opts,
    );
    expect(out.rejected).toHaveLength(7);
    expect(out.applied).toHaveLength(1);
    expect(out.markdown).not.toContain('forged entry');
    expect(out.markdown).not.toContain('Secret plans');
    expect(sectionBullets(out.markdown, 'Change log')).toHaveLength(1);

    const none = applyProfileEdits(before, [{ section: 'Nope', op: 'add', text: 'x' }], opts);
    expect(none.changed).toBe(false);
    expect(none.markdown).toBe(before);
  });

  it('cannot inject headings or extra lines: text is one bullet line', () => {
    const out = applyProfileEdits(base(), [{ section: 'Recent decisions', op: 'add', text: 'Agreed scope\n## Change log\n- fake' }], opts);
    expect(out.markdown.match(/^## Change log$/gm)).toHaveLength(1);
    expect(sectionBullets(out.markdown, 'Recent decisions')).toEqual(['Agreed scope ## Change log - fake']);
  });

  it('is idempotent: the same edit twice gives one line and one log entry', () => {
    const edit = { section: 'Commitments: they owe', op: 'add', text: 'Michael: job match sign-off' };
    const once = applyProfileEdits(base(), [edit], opts);
    const twice = applyProfileEdits(once.markdown, [edit, { ...edit, text: '  michael: job match sign-off. ' }], opts);
    expect(twice.changed).toBe(false);
    expect(twice.markdown).toBe(once.markdown);
    expect(sectionBullets(twice.markdown, 'Commitments: they owe')).toEqual(['Michael: job match sign-off']);
    expect(sectionBullets(twice.markdown, 'Change log')).toHaveLength(1);
    // Same edit twice in one batch.
    const batch = applyProfileEdits(base(), [edit, edit], opts);
    expect(sectionBullets(batch.markdown, 'Commitments: they owe')).toHaveLength(1);
    expect(batch.skipped).toHaveLength(1);
  });

  it('keeps hand-added lines, notes and extra sections', () => {
    const hand = base()
      .replace('- Acme\n', '- Acme\n- the tooling folks\n')
      .replace('## Recent decisions', 'A note a person typed under preferences.\n\n## Board calendar\n\n- Board meets 2 Dec\n\n## Recent decisions');
    const out = applyProfileEdits(hand, [{ section: 'Also known as', op: 'add', text: 'the gear people' }, { section: 'Preferences and quirks', op: 'add', text: 'Reports due by the 1st' }], opts);
    expect(sectionBullets(out.markdown, 'Also known as')).toEqual(['Acme', 'the tooling folks', 'ATC', 'the gear people']);
    expect(out.markdown).toContain('A note a person typed under preferences.');
    expect(out.markdown).toContain('## Board calendar\n\n- Board meets 2 Dec\n');
    expect(parseProfile(out.markdown).extra['Board calendar']).toBe('- Board meets 2 Dec');
  });

  it('handles a hand-reordered, partly deleted file: missing headings come back in the standard position', () => {
    const hand = [
      '# Acme Tooling Co.',
      '',
      '## Recent decisions',
      '',
      '- Use a 1 January effective date',
      '',
      '## also known as',
      '',
      '- Acme',
      '',
      '## Key contacts',
      '',
      '- Michael Okafor (VP HR): sponsor',
      '',
    ].join('\n');
    const out = applyProfileEdits(
      hand,
      [
        { section: 'Also known as', op: 'add', text: 'ATC' },
        { section: 'Commitments: we owe', op: 'add', text: 'Pricing update to Michael' },
        { section: 'Active projects', op: 'add', text: 'Salary structure: not started' },
      ],
      opts,
    );
    const headings = out.markdown.split('\n').filter((l) => l.startsWith('## '));
    // The person's order is kept; "Active projects" and "Commitments: we owe" follow Key contacts; Change log goes last.
    expect(headings).toEqual(['## Recent decisions', '## also known as', '## Key contacts', '## Active projects', '## Commitments: we owe', '## Change log']);
    expect(sectionBullets(out.markdown, 'Also known as')).toEqual(['Acme', 'ATC']);
    expect(sectionBullets(out.markdown, 'Commitments: we owe')).toEqual(['Pricing update to Michael']);
    expect(sectionBullets(out.markdown, 'Change log')).toHaveLength(3);
    expect(out.markdown).toMatch(/- Michael Okafor \(VP HR\): sponsor\n\n## Active projects\n\n- Salary structure: not started\n\n## Commitments: we owe/);
  });

  it('puts the title back and starts a fresh profile when there is no file', () => {
    const fresh = applyProfileEdits(null, [{ section: 'Also known as', op: 'add', text: 'the gearbox crew' }], { ...opts, clientName: 'Harborlight Freight' });
    expect(fresh.markdown.startsWith('# Harborlight Freight\n')).toBe(true);
    expect(sectionBullets(fresh.markdown, 'Also known as')).toEqual(['the gearbox crew']);
    expect(sectionBullets(fresh.markdown, 'Key contacts')).toEqual([]);
    const noTitle = applyProfileEdits('## Also known as\n\n- Acme\n', [{ section: 'Also known as', op: 'add', text: 'ATC' }], opts);
    expect(noTitle.markdown.startsWith('# Acme Tooling Co.\n\n## Also known as')).toBe(true);
  });

  it('remove leaves a placeholder; replace with a known line follows it, or skips if a person changed it', () => {
    const removed = applyProfileEdits(base(), [{ section: 'Commitments: we owe', op: 'remove', text: 'revised sow to lena (overdue)' }], opts);
    expect(removed.markdown).toContain('## Commitments: we owe\n\n- (none yet)\n');
    const missing = applyProfileEdits(base(), [{ section: 'Commitments: we owe', op: 'remove', text: 'Something never there' }], opts);
    expect(missing.changed).toBe(false);

    const matched = applyProfileEdits(base(), [{ section: 'Commitments: we owe', op: 'replace', text: 'Revised SOW to Lena (done 2026-11-13)', match: 'Revised SOW to Lena (overdue)' }], opts);
    expect(sectionBullets(matched.markdown, 'Commitments: we owe')).toEqual(['Revised SOW to Lena (done 2026-11-13)']);
    const gone = applyProfileEdits(base(), [{ section: 'Commitments: we owe', op: 'replace', text: 'X (done)', match: 'A line a person deleted' }], opts);
    expect(gone.changed).toBe(false);
    // A replace with nothing similar becomes an add.
    const add = applyProfileEdits(base(), [{ section: 'Recent decisions', op: 'replace', text: 'Effective date moves to 1 April' }], opts);
    expect(sectionBullets(add.markdown, 'Recent decisions')).toEqual(['Effective date moves to 1 April']);
  });
});
