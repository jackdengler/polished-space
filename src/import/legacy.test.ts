import { describe, expect, it } from 'vitest';
import { emptyWorkspace, WorkspaceSchema, type Workspace } from '../model/schema';
import { convertLegacyClients } from './legacy';

// Fictional data in the old tracker's export shape.
const legacy = {
  id: 'client_111',
  name: 'Acme Robotics',
  logo: 'data:image/png;base64,AAAA',
  customLogo: 'data:image/png;base64,BBBB',
  plannedThrough: '2027-02-01',
  staffing: { principal: ['Pat Lee'], consultant: ['Sam Fox'], associate: [], unassigned: [] },
  team: ['Sam Fox'],
  editLog: [{ userId: 'x', at: '2026-01-01T00:00:00Z', detail: 'ignored' }],
  meetings: [
    { id: 'adhoc', isAdHoc: true, name: '', date: '', deliverables: [{ id: '1', name: 'Billing', tasks: [{ id: '2', name: 'Send invoice', assignees: ['sam fox'], due: '2026-11-01', complete: false }] }] },
    { id: '3', isAdHoc: false, name: 'Fall 2026', date: '2025-10-28', deliverables: [{ id: '4', name: 'Equity guidelines', tasks: [] }] },
  ],
  pastMeetings: [
    { id: 'adhoc_past', isAdHoc: true, name: '', date: '', deliverables: [{ id: '5', name: 'Goals', bucket: 'Internal', tasks: [{ id: '6', name: 'Draft goals', assignees: [], due: '', complete: true }] }] },
    { id: '7', isAdHoc: false, name: '9/2/25', date: '2025-08-24', deliverables: [] },
    { id: '8', isAdHoc: false, name: 'Steering Cmte', date: '2026-02-11', deliverables: [] },
  ],
};

let n = 0;
const opts = { newId: () => `id${++n}`, now: '2026-11-07T00:00:00.000Z', today: '2026-11-07' };

describe('convertLegacyClients', () => {
  it('maps clients, meetings, ad-hoc work, tasks and people', () => {
    const r = convertLegacyClients([{ name: 'a.json', data: legacy }], emptyWorkspace(), opts);
    expect(r.skipped).toEqual([]);
    const c = r.clients[0]!;
    expect(c).toMatchObject({ id: 'client_111', name: 'Acme Robotics', plannedThrough: { kind: 'exact', date: '2027-02-01' }, archived: false });

    // People: deduped case-insensitively, team = staffing + team.
    expect(r.newMembers.map((m) => m.name)).toEqual(['Pat Lee', 'Sam Fox']);
    expect(c.teamMemberIds).toHaveLength(2);

    // Ad-hoc from both current and past lists.
    expect(c.adhoc.deliverables.map((d) => d.title)).toEqual(['Billing', 'Goals']);
    const invoice = c.adhoc.deliverables[0]!.tasks[0]!;
    expect(invoice).toMatchObject({ title: 'Send invoice', dueDate: '2026-11-01', done: false });
    expect(invoice.assigneeIds).toEqual([r.newMembers[1]!.id]);
    expect(c.adhoc.deliverables[1]!.tasks[0]).toMatchObject({ dueDate: null, done: true, assigneeIds: [] });

    // A name that is a date becomes the meeting date; otherwise the name is the title.
    expect(c.meetings.map((m) => [m.title, m.date])).toEqual([
      ['', { kind: 'range', label: 'Fall 2026', start: '2026-09-01', end: '2026-11-30' }],
      ['', { kind: 'exact', date: '2025-09-02' }],
      ['Steering Cmte', { kind: 'exact', date: '2026-02-11' }],
    ]);

    expect(r.logos).toEqual([{ clientId: 'client_111', dataUrl: 'data:image/png;base64,BBBB' }]);
    expect(r.summary).toEqual([{ name: 'Acme Robotics', meetings: 3, tasks: 2 }]);
    const ws: Workspace = { ...emptyWorkspace(), teamMembers: r.newMembers, clients: r.clients };
    expect(WorkspaceSchema.safeParse(ws).success).toBe(true);
  });

  it('treats a far-future planned-through as not set, and reuses existing people', () => {
    const existing = { ...emptyWorkspace(), teamMembers: [{ id: 'm1', name: 'Pat Lee', color: '#000', role: 'Principal' as const }] };
    const r = convertLegacyClients([{ name: 'a.json', data: { ...legacy, plannedThrough: '2099-12-31' } }], existing, opts);
    expect(r.clients[0]!.plannedThrough).toBeNull();
    expect(r.clients[0]!.teamMemberIds).toContain('m1');
    expect(r.newMembers.map((m) => m.name)).toEqual(['Sam Fox']);
  });

  it('takes roles from staffing and strips old (T)/(?) markers, merging those people', () => {
    const data = { ...legacy, id: 'client_222', staffing: { principal: ['Pat Lee'], consultant: ['Sam Fox (T)'], srAssociate: ['Kim Wu (?)'] }, team: [],
      meetings: [{ id: 'adhoc', isAdHoc: true, name: '', date: '', deliverables: [{ id: '1', name: 'X', tasks: [{ id: '2', name: 't', assignees: ['Sam Fox'], due: '', complete: false }] }] }], pastMeetings: [] };
    const r = convertLegacyClients([{ name: 'a.json', data }], emptyWorkspace(), opts);
    expect(r.newMembers.map((m) => [m.name, m.role])).toEqual([['Pat Lee', 'Principal'], ['Sam Fox', 'Consultant'], ['Kim Wu', 'Sr Associate']]);
    expect(r.clients[0]!.adhoc.deliverables[0]!.tasks[0]!.assigneeIds).toEqual([r.newMembers[1]!.id]);
  });

  it('keeps every assignee', () => {
    const data = { ...legacy, id: 'client_333', staffing: {}, team: [], pastMeetings: [],
      meetings: [{ id: 'adhoc', isAdHoc: true, name: '', date: '', deliverables: [{ id: '1', name: 'X', tasks: [{ id: '2', name: 't', assignees: ['Pat Lee', 'Sam Fox', 'pat lee'], due: '', complete: false }] }] }] };
    const r = convertLegacyClients([{ name: 'a.json', data }], emptyWorkspace(), opts);
    expect(r.clients[0]!.adhoc.deliverables[0]!.tasks[0]!.assigneeIds).toHaveLength(2);
  });

  it('skips files that are not client exports or are already imported', () => {
    const existing = { ...emptyWorkspace(), clients: convertLegacyClients([{ name: 'a', data: legacy }], emptyWorkspace(), opts).clients };
    const r = convertLegacyClients([{ name: 'a.json', data: legacy }, { name: 'b.json', data: { foo: 1 } }], existing, opts);
    expect(r.clients).toEqual([]);
    expect(r.skipped.map((s) => s.file)).toEqual(['a.json', 'b.json']);
  });
});
