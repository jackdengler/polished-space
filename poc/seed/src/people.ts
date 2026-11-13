/**
 * Every person, company and domain in the seed. All invented. Domains use
 * the reserved `.example` ending. Tests check that no other person name or
 * domain appears anywhere in the seeded data.
 */

export const FIRM_DOMAIN = 'brightline-advisory.example';

export interface TeamSeed {
  id: string;
  name: string;
  email: string;
  color: string;
  role: 'Principal' | 'Sr Consultant' | 'Consultant' | 'Sr Associate';
}

/** The team. "Me" is Alex Rivera (the same invented name src/model/demo.ts uses). */
export const TEAM: TeamSeed[] = [
  { id: 'poc-member-alex', name: 'Alex Rivera', email: `alex.rivera@${FIRM_DOMAIN}`, color: '#5b6ea8', role: 'Principal' },
  { id: 'poc-member-priya', name: 'Priya Shah', email: `priya.shah@${FIRM_DOMAIN}`, color: '#4f8a8b', role: 'Consultant' },
  { id: 'poc-member-marcus', name: 'Marcus Lee', email: `marcus.lee@${FIRM_DOMAIN}`, color: '#6a8f6b', role: 'Sr Associate' },
  { id: 'poc-member-dana', name: 'Dana Kim', email: `dana.kim@${FIRM_DOMAIN}`, color: '#9a7b4f', role: 'Sr Consultant' },
];

export const ME = TEAM[0]!;
export const PRIYA = TEAM[1]!;
export const MARCUS = TEAM[2]!;
export const DANA = TEAM[3]!;

export interface ContactSeed {
  name: string;
  email: string;
  role: string;
}

export interface ClientSeed {
  id: string;
  name: string;
  nicknames: string[];
  emailDomains: string[];
  contacts: ContactSeed[];
  fileFolder: string | null;
  teamMemberIds: string[];
}

const c = (name: string, local: string, domain: string, role: string): ContactSeed => ({ name, email: `${local}@${domain}`, role });

export const ACME: ClientSeed = {
  id: 'poc-client-acme',
  name: 'Acme Tooling Co.',
  nicknames: ['Acme', 'ATC'],
  emailDomains: ['acmetooling.example'],
  contacts: [c('Michael Okafor', 'michael.okafor', 'acmetooling.example', 'VP HR'), c('Lena Hartwell', 'lena.hartwell', 'acmetooling.example', 'Compensation Manager')],
  fileFolder: 'Acme Tooling',
  teamMemberIds: [ME.id, PRIYA.id, MARCUS.id],
};

export const HARBORLIGHT: ClientSeed = {
  id: 'poc-client-harborlight',
  name: 'Harborlight Freight',
  nicknames: ['Harbor', 'HLF'],
  emailDomains: ['harborlight.example'],
  contacts: [c('Dmitri Vance', 'dmitri.vance', 'harborlight.example', 'Director of Total Rewards'), c('Priscilla Mbeki', 'priscilla.mbeki', 'harborlight.example', 'HR Business Partner')],
  fileFolder: 'Harborlight Freight',
  teamMemberIds: [ME.id, PRIYA.id],
};

export const QUILLON: ClientSeed = {
  id: 'poc-client-quillon',
  name: 'Quillon Robotics',
  nicknames: ['Quill'],
  emailDomains: ['quillon.example'],
  contacts: [c('Renata Solis', 'renata.solis', 'quillon.example', 'Head of People')],
  fileFolder: 'Quillon Robotics',
  teamMemberIds: [ME.id, MARCUS.id],
};

export const TESSERA: ClientSeed = {
  id: 'poc-client-tessera',
  name: 'Tessera Foods',
  nicknames: ['Tess', 'TF'],
  emailDomains: ['tesserafoods.example'],
  contacts: [c('Gareth Lindqvist', 'gareth.lindqvist', 'tesserafoods.example', 'CHRO')],
  fileFolder: 'Tessera Foods',
  teamMemberIds: [ME.id, DANA.id],
};

/** The team's own work. Its id goes in config as the "Internal" section. */
export const INTERNAL: ClientSeed = {
  id: 'poc-client-internal',
  name: 'Internal',
  nicknames: [],
  emailDomains: [],
  contacts: [],
  fileFolder: null,
  teamMemberIds: TEAM.map((t) => t.id),
};

export const CLIENTS: ClientSeed[] = [ACME, HARBORLIGHT, QUILLON, TESSERA, INTERNAL];

/** Look up a client contact by name (throws if missing, so typos fail fast). */
export function contact(client: ClientSeed, name: string): { name: string; address: string } {
  const found = client.contacts.find((x) => x.name === name);
  if (!found) throw new Error(`no contact ${name} at ${client.name}`);
  return { name: found.name, address: found.email };
}

export const me = { name: ME.name, address: ME.email };
export const teammate = (t: TeamSeed) => ({ name: t.name, address: t.email });

/** Every invented person name used anywhere in the seed (the allow-list). */
export const INVENTED_PEOPLE: string[] = [...TEAM.map((t) => t.name), ...CLIENTS.flatMap((cl) => cl.contacts.map((x) => x.name))];

/** Every domain allowed in the seed. */
export const INVENTED_DOMAINS: string[] = [FIRM_DOMAIN, ...CLIENTS.flatMap((cl) => cl.emailDomains)];
