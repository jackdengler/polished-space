/**
 * Generated client files (PDFs) and starter client profiles.
 * Text files live as-is under poc/seed/files/<Client Folder>/.
 */
import { renderProfile, type ProfileContent } from '@poc/contracts';
import { makePdf } from './pdf';
import { ACME, HARBORLIGHT, QUILLON, TESSERA, type ClientSeed } from './people';

/** PDFs written by the seed: path relative to the files root -> bytes. */
export function buildPdfs(): Record<string, Uint8Array> {
  return {
    'Harborlight Freight/HLF Driver Pay Structure Draft.pdf': makePdf('Harborlight Freight: Driver Pay Structure (Draft)', [
      'Prepared by Brightline Advisory for Dmitri Vance. Draft for discussion.',
      '',
      '# Summary',
      'We propose hourly pay bands for linehaul drivers, local delivery drivers and driver trainers, with a regional differential on top of a single national band.',
      '',
      '# Proposed bands (hourly base)',
      'Local Delivery Driver: 22.50 to 27.50, midpoint 25.00',
      'Linehaul Driver: 25.50 to 32.50, midpoint 29.00',
      'Driver Trainer: 29.50 to 36.00, midpoint 32.75',
      '',
      '# Regional differentials',
      'Coastal: +6% (higher cost of labour and turnover).',
      'North: 0% (reference region).',
      'Inland: -3% (lower market rates; protect current pay, no cuts).',
      '',
      '# Cost to implement',
      'Moving everyone below the new minimum up to it costs about 1.4% of driver payroll. Most of the cost sits in the Inland region.',
      '',
      '# Open questions for Harborlight',
      '1. Should overtime be part of the total cash comparison? Overtime fields are still missing from the census.',
      '2. Is a 6% Coastal differential acceptable, or should it phase in over two years?',
      '3. Should driver trainers carry a fixed premium instead of a separate band?',
      '',
      '# Next steps',
      'Agree the differentials, then model total cash once the updated census arrives.',
    ]),
    'Acme Tooling/Acme Market Pricing Methodology.pdf': makePdf('Acme Tooling Co.: Market Pricing Methodology', [
      'How the market pricing analysis was done. Prepared by Brightline Advisory.',
      '',
      '# Data',
      'Employee data comes from the HRIS census provided by Lena Hartwell. Market data comes from two pay surveys, Survey A (industrial) and Survey B (manufacturing).',
      '',
      '# Matching',
      'Each Acme job is matched to the closest survey job by duties and level. Matches are rated Good or Weak. Weak matches are flagged for client review.',
      '',
      '# Aging',
      'Survey data is aged to a 1 January effective date at 3.5% a year.',
      '',
      '# Measures',
      'The market ratio is the Acme median base pay divided by the market median (P50). Ratios between 0.95 and 1.05 are treated as at market.',
    ]),
  };
}

function contactsLines(c: ClientSeed, notes: Record<string, string>): string[] {
  return c.contacts.map((x) => `${x.name} (${x.role}, ${x.email}): ${notes[x.name] ?? ''}`.replace(/: $/, ''));
}

/** Starter profiles, one per client (not Internal). */
export function buildProfiles(nowIso: string): { client: ClientSeed; markdown: string }[] {
  const log = [`${nowIso}: Seeded starter profile.`];
  const make = (client: ClientSeed, content: ProfileContent) => ({
    client,
    markdown: renderProfile(client.name, { 'Also known as': client.nicknames, ...content, 'Change log': log }),
  });
  return [
    make(ACME, {
      'Key contacts': contactsLines(ACME, {
        'Michael Okafor': 'sponsor; signs off scope and job matches; wants to be looped in on scope and timing only',
        'Lena Hartwell': 'day-to-day contact; data and SOW questions',
      }),
      'Active projects': [
        'Market pricing analysis: summary draft in progress; market data review meeting coming up',
        'Salary structure: starts after pricing is agreed',
      ],
      'Commitments: we owe': ['Revised SOW to Lena (overdue)', 'Market pricing summary for the market data review'],
      'Commitments: they owe': ['Michael: job match sign-off (asked 5 days ago, no reply yet)', 'Lena: whether shift premiums count as base'],
      'Preferences and quirks': ['Michael prefers short written updates over long calls', 'Board meets at the start of each month; board pack deadlines matter'],
      'Recent decisions': ['Use a 1 January effective date unless finance objects'],
    }),
    make(HARBORLIGHT, {
      'Key contacts': contactsLines(HARBORLIGHT, {
        'Dmitri Vance': 'decision maker on driver pay',
        'Priscilla Mbeki': 'scheduling and data logistics; send meeting invites through her',
      }),
      'Active projects': ['Driver pay structure: draft bands written; census sample received, overtime fields pending'],
      'Commitments: we owe': ['Review the driver census sample', 'Regional differentials draft'],
      'Commitments: they owe': ['Payroll: overtime fields for the driver census'],
      'Preferences and quirks': ['Mornings work best for Dmitri', 'Invites go through Priscilla'],
      'Recent decisions': ['Protect current pay in the Inland region (no cuts)'],
    }),
    make(QUILLON, {
      'Key contacts': contactsLines(QUILLON, { 'Renata Solis': 'owns the job architecture project' }),
      'Active projects': ['Job architecture: draft levels sent for feedback; readout coming up'],
      'Commitments: we owe': ['Readout deck', 'Map engineering titles to levels'],
      'Commitments: they owe': ['Renata: feedback on the job levels draft (sent 6 days ago, no reply yet)'],
      'Preferences and quirks': ['Renata likes a short agenda the day before any meeting'],
      'Recent decisions': [],
    }),
    make(TESSERA, {
      'Key contacts': contactsLines(TESSERA, { 'Gareth Lindqvist': 'sponsor; reports to the CFO on budget' }),
      'Active projects': ['Pay equity audit: comparator groups being confirmed; findings meeting coming up'],
      'Commitments: we owe': ['Confirm comparator group list (overdue)', 'Pay equity memo outline'],
      'Commitments: they owe': ['Job descriptions for warehouse lead roles'],
      'Preferences and quirks': ['Gareth wants budget implications called out early'],
      'Recent decisions': ['Warehouse leads likely a separate comparator group (pending confirmation)'],
    }),
  ];
}
