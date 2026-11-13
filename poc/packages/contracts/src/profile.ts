import { z } from 'zod';
import { IsoDateTime } from './common';

/**
 * Client profile files: `poc/data/profiles/<slug>.md`, plain markdown the
 * team can open and correct (plan section 4). Fixed layout:
 *
 *   # <Client name>
 *   ## Also known as
 *   ## Key contacts
 *   ## Active projects
 *   ## Commitments: we owe
 *   ## Commitments: they owe
 *   ## Preferences and quirks
 *   ## Recent decisions
 *   ## Change log
 *
 * Each section body is a markdown bullet list ("- ..."). The assistant edits
 * the first seven sections through ProfileEdit; only code appends to
 * "Change log" (one bullet per change, newest last, starting with an ISO time).
 */

/** The `##` headings, in file order (without the leading `## `). */
export const PROFILE_SECTIONS = [
  'Also known as',
  'Key contacts',
  'Active projects',
  'Commitments: we owe',
  'Commitments: they owe',
  'Preferences and quirks',
  'Recent decisions',
  'Change log',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The sections a ProfileEdit may target (all but the change log). */
export const EDITABLE_PROFILE_SECTIONS = [
  'Also known as',
  'Key contacts',
  'Active projects',
  'Commitments: we owe',
  'Commitments: they owe',
  'Preferences and quirks',
  'Recent decisions',
] as const satisfies readonly ProfileSection[];
export type EditableProfileSection = (typeof EDITABLE_PROFILE_SECTIONS)[number];

/** Full heading lines, in order, including the title placeholder. */
export const PROFILE_HEADINGS = ['# <Client>', ...PROFILE_SECTIONS.map((s) => `## ${s}`)] as const;

/** File slug for a client name: "Acme Tooling Co." -> "acme-tooling-co". */
export function profileSlug(clientName: string): string {
  return clientName
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Section bodies as bullet lines (without the "- "). Missing sections are empty. */
export type ProfileContent = Partial<Record<ProfileSection, string[]>>;

/** Render a profile file. Empty sections get "- (none yet)" so the file reads well by hand. */
export function renderProfile(clientName: string, content: ProfileContent): string {
  const parts = [`# ${clientName}`, ''];
  for (const section of PROFILE_SECTIONS) {
    const lines = content[section] ?? [];
    parts.push(`## ${section}`, '', ...(lines.length ? lines.map((l) => `- ${l}`) : ['- (none yet)']), '');
  }
  return parts.join('\n');
}

/**
 * Split a profile file into its title and raw section bodies (text between
 * headings, trimmed). Unknown `##` headings a person added are kept under
 * `extra` so a rewrite can preserve them.
 */
export function parseProfile(markdown: string): {
  title: string;
  sections: Partial<Record<ProfileSection, string>>;
  extra: Record<string, string>;
} {
  const title = /^# (.+)$/m.exec(markdown)?.[1]?.trim() ?? '';
  const sections: Partial<Record<ProfileSection, string>> = {};
  const extra: Record<string, string> = {};
  const chunks = markdown.split(/^## /m).slice(1);
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n');
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    const body = nl < 0 ? '' : chunk.slice(nl + 1).trim();
    if ((PROFILE_SECTIONS as readonly string[]).includes(heading)) sections[heading as ProfileSection] = body;
    else extra[heading] = body;
  }
  return { title, sections, extra };
}

/** `GET /api/profiles` item. */
export const ProfileSummary = z.object({
  clientId: z.string(),
  clientName: z.string(),
  slug: z.string(),
  updatedAt: IsoDateTime,
});
export type ProfileSummary = z.infer<typeof ProfileSummary>;
export const ProfileListResponse = z.object({ profiles: z.array(ProfileSummary) });
export type ProfileListResponse = z.infer<typeof ProfileListResponse>;

/** `GET /api/profiles/:clientId` response. */
export const ProfileDoc = ProfileSummary.extend({ markdown: z.string() });
export type ProfileDoc = z.infer<typeof ProfileDoc>;
