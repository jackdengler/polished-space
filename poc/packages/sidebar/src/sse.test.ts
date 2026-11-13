import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';
import { arrange } from './derive';
import { fixtureState } from './test/helpers';

describe('SseParser', () => {
  it('parses events split across chunks, CRLF, comments and multi-line data', () => {
    const p = new SseParser();
    const out = [...p.push('event: delta\r'), ...p.push('\ndata: {"text":"Hel'), ...p.push('lo"}\r\n\r\n: ping\n\nevent: done\ndata: a\ndata: b\n\n')];
    expect(out).toEqual([
      { event: 'delta', data: '{"text":"Hello"}' },
      { event: 'done', data: 'a\nb' },
    ]);
  });
});

describe('arrange', () => {
  it('puts prepared suggestions on their task only, nudge suggestions under the nudge, needs-a-client in Inbox', () => {
    const a = arrange(fixtureState(), []);
    const all = [...a.nudges.flatMap((n) => n.suggestions), ...a.inbox, ...a.loose].map((s) => s.id);
    expect(all.some((id) => id.startsWith('sg-prep-'))).toBe(false);
    expect(a.nudges[0]!.suggestions.map((s) => s.id)).toEqual(['sg-acme-update', 'sg-acme-meet', 'sg-acme-dup']);
    expect(a.inbox.map((s) => s.id).sort()).toEqual(['sg-confirm', 'sg-robo-deck']);
    expect(new Set(all).size).toBe(all.length);
  });
  it('a dismissed nudge releases its suggestions to the list', () => {
    const a = arrange(fixtureState(), ['n-acme']);
    expect(a.loose.map((s) => s.id)).toContain('sg-acme-update');
  });
});
