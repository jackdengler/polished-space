import { describe, expect, it } from 'vitest';
import { findAliases } from './people';
import type { Role, TeamMember } from './schema';

// Fictional names.
let n = 0;
const p = (name: string, role: Role = 'Unassigned'): TeamMember => ({ id: `p${++n}-${name}`, name, color: '#000', role });

describe('findAliases', () => {
  const people = [
    p('Samantha Reyes', 'Sr Consultant'), p('Sam'),
    p('Toby Brand', 'Principal'), p('Toby Lang', 'Principal'), p('Toby'),          // ambiguous short name
    p('Nora K.'), p('Nora Kline', 'Associate'),
    p('Ivan Petrof'), p('Ivan Petrov', 'Principal'),                               // typo, keep the one with a role
    p('Wes Holm'), p('Wesley Holme', 'Associate'),                                  // nickname + typo
    p('Gil'), p('Gilbert Moss', 'Consultant'),
    p('Zed'),                                                                       // no match
  ];
  const byName = (name: string) => people.find((x) => x.name === name)!.id;
  const pairs = findAliases(people).map((a) => [people.find((x) => x.id === a.fromId)!.name, people.find((x) => x.id === a.intoId)!.name]);

  it('matches short names, initials and small typos to the full person with a role', () => {
    expect(pairs).toEqual(expect.arrayContaining([
      ['Sam', 'Samantha Reyes'], ['Nora K.', 'Nora Kline'], ['Ivan Petrof', 'Ivan Petrov'], ['Wes Holm', 'Wesley Holme'], ['Gil', 'Gilbert Moss'],
    ]));
  });
  it('skips ambiguous and unmatched names', () => {
    const froms = findAliases(people).map((a) => a.fromId);
    expect(froms).not.toContain(byName('Toby'));
    expect(froms).not.toContain(byName('Zed'));
    expect(froms).not.toContain(byName('Ivan Petrov'));
  });
});
