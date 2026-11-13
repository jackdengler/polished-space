import type { TeamMember } from './schema';

/**
 * Finds people who are probably the same person written differently, the way
 * the old app resolved near-matches to the People list:
 *   "Sam" → "Samantha Reyes"     (one name that starts a single full name)
 *   "Nora K." → "Nora Kline"     (first name + last initial)
 *   "Ivan Petrof" → "Ivan Petrov", "Wes Holm" → "Wesley Holme"  (small typos)
 * Only unambiguous matches are returned. The person kept is the one with a
 * role, then the one used on more tasks, then the fuller name.
 */
export interface Alias { fromId: string; intoId: string }

const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, '').trim();
const parts = (name: string) => norm(name).split(/\s+/).filter(Boolean);

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Same first name, allowing nicknames/short forms that share the first 3 letters ("Wes"/"Wesley", "Gil"/"Gilbert"). */
const firstNamesMatch = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 3 && a.slice(0, 3) === b.slice(0, 3) && (a.startsWith(b) || b.startsWith(a) || Math.min(a.length, b.length) <= 4));

function sameishPerson(short: TeamMember, full: TeamMember): boolean {
  const s = parts(short.name), f = parts(full.name);
  if (f.length < 2 || short.id === full.id) return false;
  if (s.length === 1) return firstNamesMatch(s[0]!, f[0]!);
  if (s.length === 2 && s[1]!.length === 1) return firstNamesMatch(s[0]!, f[0]!) && f[f.length - 1]![0] === s[1]; // "Tom B."
  if (s.length >= 2) {
    const ls = s[s.length - 1]!, lf = f[f.length - 1]!;
    return firstNamesMatch(s[0]!, f[0]!) && ls !== lf && Math.max(ls.length, lf.length) >= 4 && editDistance(ls, lf) <= 2;
  }
  return false;
}

export function findAliases(members: TeamMember[], taskCount: (id: string) => number = () => 0): Alias[] {
  const score = (m: TeamMember) => [m.role !== 'Unassigned' ? 1 : 0, taskCount(m.id), parts(m.name).length, m.name.length] as const;
  const better = (a: TeamMember, b: TeamMember) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i]! > sb[i]!;
    return a.name.localeCompare(b.name) < 0;
  };
  const out: Alias[] = [];
  const taken = new Set<string>();
  for (const m of members) {
    if (taken.has(m.id)) continue;
    const matches = members.filter((o) => !taken.has(o.id) && sameishPerson(m, o));
    // Spelling variants match both ways; keep the better-scored one.
    const candidates = matches.filter((o) => parts(m.name).length === 1 || parts(m.name)[1]!.length === 1 || better(o, m));
    if (candidates.length !== 1) continue; // ambiguous ("Tom" with three Toms) or none
    out.push({ fromId: m.id, intoId: candidates[0]!.id });
    taken.add(m.id);
  }
  return out;
}
