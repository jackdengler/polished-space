import { describe, expect, it } from 'vitest';
import { CLIENTS } from '../testing/harness';
import { fingerprint, mentions, prematch } from './prematch';

const ids = (r: { clientId: string }[]) => r.map((c) => c.clientId);

describe('prematch', () => {
  it('matches sender domain and contact address strongly', () => {
    const r = prematch({ sender: 'michael.okafor@acmetooling.example', text: 'Where are we?' }, CLIENTS);
    expect(ids(r)).toEqual(['poc-client-acme']);
    expect(r[0]!.reasons).toEqual(expect.arrayContaining(['sender domain acmetooling.example', 'sender is a contact']));
  });

  it('tags chat by nickname, file name and learned shorthand, not by a teammate sender', () => {
    expect(ids(prematch({ sender: 'priya.shah@brightline-advisory.example', text: 'Harbor sent over "HLF Driver Pay Structure Draft.pdf".' }, CLIENTS, { files: { 'poc-client-harborlight': ['HLF Driver Pay Structure Draft.pdf'] } }))).toEqual(['poc-client-harborlight']);
    expect(ids(prematch({ text: 'The robo team asked again.' }, CLIENTS))).toEqual([]);
    expect(ids(prematch({ text: 'The robo team asked again.' }, CLIENTS, { aliases: { 'poc-client-quillon': ['the robo team'] } }))).toEqual(['poc-client-quillon']);
  });

  it('uses contact first names weakly and project names', () => {
    const r = prematch({ text: 'add a task to chase Michael on Friday about the market data review' }, CLIENTS);
    expect(ids(r)).toEqual(['poc-client-acme']);
    expect(r[0]!.reasons).toEqual(expect.arrayContaining(['mentions "Michael"', 'project "Market data review"']));
  });

  it('matches whole words only, short all-caps tokens case-sensitively', () => {
    expect(mentions('ATC wants it', 'ATC')).toBe(true);
    expect(mentions('the atc thing', 'ATC')).toBe(false);
    expect(mentions('Tessera Foods', 'Tess')).toBe(false);
    expect(mentions('harbor update', 'Harbor')).toBe(true);
    expect(mentions('Harborlight', 'Harbor')).toBe(false);
  });

  it('ignores archived clients', () => {
    const archived = CLIENTS.map((c) => (c.id === 'poc-client-acme' ? { ...c, archived: true } : c));
    expect(ids(prematch({ sender: 'michael.okafor@acmetooling.example', text: 'x' }, archived))).toEqual([]);
  });

  it('fingerprints by content, ignoring case and spacing', () => {
    expect(fingerprint('mail', 'A@x.example', 'Hi', 'Hello  there')).toBe(fingerprint('mail', 'a@x.example', 'hi', 'hello there'));
    expect(fingerprint('mail', 'a@x.example', 'Hi', 'Hello')).not.toBe(fingerprint('chat', 'a@x.example', 'Hi', 'Hello'));
  });
});
