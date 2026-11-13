// ============================================================================
//  TEST STAND-IN FOR THE CLAUDE API. NOT CLAUDE. NOT FOR DEMOS.
// ============================================================================
//
// A small scripted HTTP server that speaks enough of the Anthropic Messages
// API (POST /v1/messages: JSON replies, structured outputs via
// output_config.format, and SSE streaming with text and tool_use blocks) for
// the brain's REAL SDK client to run end to end with no API key and no
// network. Answers are deterministic and derived from the request content
// with plain rules (regexes over the prompt the brain builds), so the e2e
// check can prove the plumbing: right client, tasks in both directions,
// duplicates, prepared work per task type, an order for Today, chat tool
// calls, streaming and barge-in aborts, usage numbers and cache reads.
//
// It proves nothing about the quality of Claude's answers. Live mode
// (POC_E2E_LIVE=1) runs the same steps against the real API.
//
// Used only by poc/e2e/demo.mjs and by `dev:up -- --claude-standin` when asked
// for explicitly. `up` and `dev:up` never use it by default.
//
//   import { startStandin } from './claude-standin.mjs';
//   const s = await startStandin({ port: 0, log: 'poc/test-results/demo/standin.jsonl' });
//   // s.url -> set POC_CLAUDE_BASE_URL to it; s.requests -> what it saw
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const tokens = (s) => Math.max(1, Math.ceil(s.length / 4));
const first = (name) => String(name).split(/\s+/)[0];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** "add a task to ..." and its usual mishearings by speech recognition ("at the task to ..."). */
const ADD_TASK = /^(please\s+)?(can you\s+)?(add|at|ad|and|create|make)\s+(a\s+|the\s+)?(task|to-?do|reminder)\s+(to\s+)?/i;

// ---- reading the request -----------------------------------------------------

function blockText(b) {
  if (typeof b === 'string') return b;
  if (!b || typeof b !== 'object') return '';
  if (b.type === 'text') return b.text ?? '';
  if (b.type === 'tool_result') return typeof b.content === 'string' ? b.content : (b.content ?? []).map(blockText).join('\n');
  if (b.type === 'tool_use') return JSON.stringify(b.input ?? {});
  return '';
}
const contentText = (c) => (typeof c === 'string' ? c : (c ?? []).map(blockText).join('\n'));
const systemText = (body) => (typeof body.system === 'string' ? body.system : (body.system ?? []).map(blockText).join('\n'));
const allText = (body) => [systemText(body), ...(body.messages ?? []).map((m) => contentText(m.content))].join('\n');

/** Classify the call from its output schema (structured outputs) or its shape. */
function classify(body) {
  const props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  const has = (...k) => k.every((x) => props.includes(x));
  if (has('tasks', 'meetingRequest')) return 'triage';
  if (has('order', 'fitNow')) return 'prioritise';
  if (has('edits')) return 'profile';
  if (has('slotIds')) return 'prepare:schedule_meeting';
  if (has('keyPoints')) return 'prepare:review_file';
  if (has('notes', 'summary')) return 'prepare:other';
  if (has('subject', 'body', 'nextStep')) return /Task type: follow_up/.test(allText(body)) ? 'prepare:follow_up' : 'prepare:reply_email';
  if (body.tools?.length) return 'chat';
  return 'plain';
}

/** Today (YYYY-MM-DD) from "Now: <ISO>" in the prompt. */
function todayOf(text) {
  const m = /\(today is (?:\w+ )?(\d{4}-\d{2}-\d{2})/.exec(text) ?? /Now: \w+ (\d{4}-\d{2}-\d{2})/.exec(text) ?? /Now: (\d{4}-\d{2}-\d{2})/.exec(text);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayIdx = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
/** The next given weekday strictly after `today` ("Friday" means the next Friday after today). */
const nextWeekday = (today, idx) => {
  let d = addDays(today, 1);
  while (weekdayIdx(d) !== idx) d = addDays(d, 1);
  return d;
};
/** `n` working days (Mon-Fri) after `iso`. */
const workdaysAfter = (iso, n) => {
  let d = iso;
  for (let k = 0; k < n; ) {
    d = addDays(d, 1);
    if (weekdayIdx(d) < 5) k++;
  }
  return d;
};
/** A due date from the text. `strict`: only "by/before/on/until <day>" counts (a meeting preference is not a deadline). */
function dueFrom(text, today, strict = false) {
  const t = text.toLowerCase();
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`${strict ? '\\b(by|before|on|until) ' : '\\b'}${WEEKDAYS[i].toLowerCase()}\\b`).test(t)) {
      const before = new RegExp(`before ${WEEKDAYS[i].toLowerCase()}`).test(t);
      const d = nextWeekday(today, i);
      return before ? addDays(d, -1) : d;
    }
  }
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (!strict && /\bnext week\b/.test(t)) return nextWeekday(today, 0);
  return null;
}

// ---- triage --------------------------------------------------------------------

function parseRoster(sys) {
  const i = sys.indexOf('Client roster (JSON):');
  if (i < 0) return [];
  try {
    return JSON.parse(sys.slice(sys.indexOf('[', i)));
  } catch {
    return [];
  }
}

const STRONG = /sender domain|sender is a contact|names "|nickname "|learned shorthand|^mentions [A-Z]\w+ [A-Z]|names file|a client address/;

function taskTypeOfTitle(title) {
  const t = title.toLowerCase();
  if (/^reply|^answer/.test(t)) return 'reply_email';
  if (/meeting|^set up|^book a|^schedule/.test(t)) return 'schedule_meeting';
  if (/^review|^read/.test(t)) return 'review_file';
  if (/^chase|^follow up|^nudge/.test(t)) return 'follow_up';
  if (/^expect/.test(t)) return 'expect';
  return 'other';
}

function triage(body) {
  const sys = systemText(body);
  const roster = parseRoster(sys);
  const user = (body.messages ?? []).map((m) => contentText(m.content)).join('\n');
  const today = todayOf(user);
  const itemM = /<item kind="(\w+)">\n([\s\S]*?)\n<\/item>/.exec(user);
  const kind = itemM?.[1] ?? 'manual';
  const item = itemM?.[2] ?? '';
  const header = item.split('\n')[0];
  const subject = /^Subject: (.*)$/m.exec(item)?.[1] ?? '';
  const text = item.split('\n').slice(subject ? 2 : 1).join('\n').trim();
  const senderM = /^(?:Email|Chat message) from ([^<]+?) <([^>]+)>/.exec(header);
  const senderName = senderM?.[1]?.trim() ?? '';
  const firmDomain = /Their firm's domain is (\S+?)\./.exec(sys)?.[1] ?? '';
  const fromFirm = !!senderM && !!firmDomain && senderM[2].toLowerCase().endsWith(`@${firmDomain.toLowerCase()}`);
  const hints = [...user.matchAll(/^- (poc-client-[\w-]+): (.*)$/gm)].map((m) => ({ clientId: m[1], reasons: m[2].split('; ') }));
  const openTasks = [...user.matchAll(/^- task (\S+) \| (\S+) \| (.*?) \| due/gm)].map((m) => ({ kind: 'task', id: m[1], clientId: m[2], title: m[3] }));
  const pending = [...user.matchAll(/^- suggestion (\S+) \| (\S+) \| (.*?) \| due/gm)].map((m) => ({ kind: 'suggestion', id: m[1], clientId: m[2], title: m[3] }));

  // Client: strong pre-match signals -> high. A first name only one client has -> high.
  let clientId = null;
  let confidence = 'low';
  let alias = null;
  const strong = hints.find((h) => h.reasons.some((r) => STRONG.test(r)));
  if (strong) {
    clientId = strong.clientId;
    confidence = 'high';
  } else if (hints.length === 1) {
    clientId = hints[0].clientId;
    confidence = 'high';
  } else {
    // Unknown shorthand like "the robo team": best guess by a client-name prefix, low confidence.
    const m = /\b(the [a-z]+ (?:team|folks|people|crew))\b/i.exec(text);
    if (m) alias = m[1];
    const words = (alias ?? text).toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const guess = roster.find((c) => c.name.toLowerCase().split(/\s+/).some((w) => words.some((x) => x !== 'team' && w.startsWith(x))));
    clientId = guess?.id ?? null;
  }
  const client = roster.find((c) => c.id === clientId) ?? null;
  const lower = text.toLowerCase();
  const tasks = [];
  const add = (title, taskType, direction, dueDate = null) => tasks.push({ title, direction, taskType, dueDate, duplicateOf: null });
  const who = senderName ? first(senderName) : '';
  void fromFirm;
  const topic = /market pricing|pricing/.test(lower) ? 'the market pricing analysis' : /memo/.test(lower) ? 'the pay equity memo' : /levels/.test(lower) ? 'the revised levels' : subject ? `"${subject}"` : 'their question';

  if (kind === 'manual' || kind === 'voice') {
    let ask = text.replace(/^\(spoken[^)]*\)\s*/i, '').replace(ADD_TASK, '').replace(/[.!?]+$/, '').trim();
    ask = ask.replace(/\s+(on|by|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, '').replace(/\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i, '').trim();
    const contact = client?.contacts.find((k) => new RegExp(`\\b${first(k.name)}\\b`, 'i').test(ask));
    if (contact) ask = ask.replace(new RegExp(`\\b${first(contact.name)}\\b(\\s+${contact.name.split(/\s+/).slice(1).join(' ')})?`, 'i'), contact.name);
    const type = /\b(chase|follow up|nudge)\b/i.test(ask) ? 'follow_up' : /\b(reply|answer|respond)\b/i.test(ask) ? 'reply_email' : /\b(review|read)\b/i.test(ask) ? 'review_file' : /\b(meet|schedule|book)\b/i.test(ask) ? 'schedule_meeting' : 'other';
    add(cap(ask || text), type, 'i_owe', dueFrom(text, today));
  } else {
    // Scheduling rule from the triage prompt (when it is on): every i_owe task gets a date;
    // a reply or meeting reply someone is waiting on is due today unless the message names a later day.
    const schedule = /Schedule what the user owes/.test(sys);
    const owe = (d) => d ?? (schedule ? today : null);
    if (/\b(we'll|we will|i'll|will) send you\b|\bsend you the\b.*\bby\b/i.test(text)) {
      const thing = /send you (?:the )?(.+?)(?: by| on|\.|$)/i.exec(text)?.[1] ?? 'what they promised';
      add(`Expect ${thing} from ${who || 'them'}`, 'other', 'owed_to_me', dueFrom(text, today, true));
    }
    const fileM = /"([^"]+\.(?:pdf|md|csv|txt))"/i.exec(text);
    if (fileM && /\b(read|review|look|check|take)\b/i.test(text)) add(`Review ${fileM[1]}`, 'review_file', 'i_owe', dueFrom(text, today, true) ?? (schedule ? workdaysAfter(today, 1) : null));
    if (/\bupdate\b|where .* stands|how is .* coming|\?/.test(lower) && !fileM && !/want me to chase/.test(lower) && !/ignore (all |your )?(previous |prior )?instructions|mark (all|every) tasks?/.test(lower)) add(`Reply to ${who || 'them'} with an update on ${topic}`, 'reply_email', 'i_owe', owe(dueFrom(text, today, true)));
    if (/\bmeet\b|minutes with you|time to talk|lock in a time|a call\b/.test(lower)) {
      const mins = /(\d{2,3})\s*minutes/.exec(lower)?.[1];
      add(`Set up a ${mins ? `${mins}-minute ` : ''}meeting with ${who || 'them'}`, 'schedule_meeting', 'i_owe', owe(null));
    }
    if (/want me to chase/.test(lower)) add(`Confirm when ${topic} go out`, 'follow_up', 'i_owe', owe(null));
  }

  // Duplicates: same client, same kind of task, same person.
  for (const t of tasks) {
    const tt = taskTypeOfTitle(t.title);
    const person = /with (\w+)|to (\w+)|from (\w+)/.exec(t.title)?.slice(1).find(Boolean);
    const dup = [...pending, ...openTasks].find((x) => (x.clientId === clientId || x.clientId === 'no') && taskTypeOfTitle(x.title) === tt && tt !== 'other' && person && new RegExp(`\\b${person}\\b`).test(x.title));
    if (dup) t.duplicateOf = { kind: dup.kind, id: dup.id };
  }

  const meetingRequest = tasks.some((t) => t.taskType === 'schedule_meeting');
  const asks = tasks.filter((t) => t.direction === 'i_owe');
  let nudge;
  if (kind === 'chat' && tasks.some((t) => t.taskType === 'review_file')) nudge = `${who || 'A colleague'} says ${client?.name ?? 'a client'} sent over a file and wants your read on it before the deadline. Want me to prepare a review?`;
  else if (tasks.some((t) => t.direction === 'owed_to_me') && !asks.length) nudge = `${who || 'Someone'} says they'll send ${/send you (?:the )?(.+?)(?: by| on|\.|$)/i.exec(text)?.[1] ?? 'something'} soon. I'll keep track of it for you.`;
  else if (meetingRequest && asks.length > 1) nudge = `${who || 'They'} just asked where ${topic} stands and wants to meet. Want me to draft a reply with some times?`;
  else if (asks.length) nudge = `${who || 'Someone'} needs something from you about ${topic}. Want me to draft a reply?`;
  else nudge = `${who || 'Someone'} sent a message about ${topic}. Nothing to do yet, but I've noted it.`;
  if (kind === 'manual' || kind === 'voice') nudge = tasks[0] ? `Shall I add "${tasks[0].title}"${tasks[0].dueDate ? ` for ${WEEKDAYS[weekdayIdx(tasks[0].dueDate)]} ${tasks[0].dueDate}` : ''}?` : 'Nothing to add from that.';
  if (alias) nudge = `${who || 'Someone'} mentioned ${alias}, and I'm not sure which client that is. Can you confirm?`;

  const profileEdits =
    confidence === 'high' && client && kind !== 'manual' && kind !== 'voice'
      ? [
          // Deliberately also proposes commitments (a real model may, despite the prompt), so the e2e proves the brain
          // holds them back until approval (D3); plus one preference-style edit that should land at triage.
          ...tasks.map((t) => ({ section: t.direction === 'owed_to_me' ? 'Commitments: they owe' : 'Commitments: we owe', op: 'add', text: t.title })),
          ...(kind === 'mail' && who ? [{ section: 'Key contacts', op: 'add', text: `${senderName}: wrote on ${today} about ${topic}` }] : []),
        ]
      : [];
  return { clientId, confidence, alias, nudge, tasks, meetingRequest, profileEdits };
}

// ---- prioritise ------------------------------------------------------------------

function prioritise(body) {
  const u = (body.messages ?? []).map((m) => contentText(m.content)).join('\n');
  const tasks = [...u.matchAll(/^- "(.*)" \(id=([^;]+); client=([^;]+); type=([^;]+); ([^;)]+)/gm)].map((m) => ({ title: m[1], id: m[2], client: m[3], type: m[4], owed: /waiting/.test(m[5]) }));
  const quick = (t) => t.type === 'reply_email' || t.type === 'follow_up' || /^(send|confirm|submit|chase)\b/i.test(t.title);
  const ordered = [...tasks.filter((t) => quick(t) && !t.owed), ...tasks.filter((t) => !quick(t) && !t.owed), ...tasks.filter((t) => t.owed)];
  const order = ordered.map((t) => ({ taskId: t.id, quickWin: quick(t) && !t.owed, reason: t.owed ? 'Waiting on someone else' : quick(t) ? 'Quick win, clear it first' : t.type === 'review_file' ? 'Needs a proper read' : 'The biggest piece due today' }));
  const gap = /^- (\d+) minutes, (\S+) to (\S+), before "(.*)" at (\S+)$/m.exec(u);
  let fitNow = null;
  if (gap && ordered.length) {
    const pick = ordered.find((t) => !quick(t) && !t.owed) ?? ordered[0];
    // Only what to do: the brain puts the code-computed gap ("You've got 1 hour 40 minutes before your 3pm ...") in front.
    fitNow = { taskId: pick.id, sentence: `Let's ${pick.title.charAt(0).toLowerCase()}${pick.title.slice(1)}.` };
  }
  const comingUp = [...u.matchAll(/^- "(.*)" \(id=([^;]+); client=([^;]+); type=([^;]+); due /gm)].map((m) => ({ title: m[1], id: m[2], type: m[4] }));
  const big = ordered.find((t) => t.type === 'review_file') ?? comingUp.find((t) => t.type === 'review_file') ?? null;
  return { order, fitNow, focusBlock: big ? { taskId: big.id, minutes: 60 } : null };
}

// ---- prepare ----------------------------------------------------------------------

const NONE = { kind: 'none', title: '', nudge: '', toName: null, subject: '', body: '', dueDate: null, taskType: 'other' };

function prepareFacts(body) {
  const msgs = body.messages ?? [];
  const blocks = msgs.flatMap((m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content));
  const text = blocks.map(blockText).join('\n');
  const pdf = blocks.find((b) => b.type === 'document')?.source?.data ?? null;
  const person = (label) => {
    const m = new RegExp(`${label}: ([^<\\n]+?) <([^>]+)>`).exec(text);
    return m ? { name: m[1].trim(), address: m[2] } : null;
  };
  const task = /Task: "([^"]+)"/.exec(text)?.[1] ?? 'this task';
  const contacts = [...(/Client contacts: (.*)\./.exec(text)?.[1] ?? '').matchAll(/([^;<]+?) <([^>]+)>/g)].map((m) => ({ name: m[1].trim(), address: m[2] }));
  const project = /## Active projects\n\n- ([^\n]+)/.exec(text)?.[1] ?? null;
  return { text, pdf, person, task, contacts, project };
}

function pdfLines(b64) {
  const bin = Buffer.from(b64, 'base64').toString('latin1');
  return [...bin.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|')/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).filter((l) => l.trim());
}

function prepare(type, body) {
  const f = prepareFacts(body);
  const sign = '\n\nBest,\nAlex';
  if (type === 'reply_email') {
    const to = f.person('Reply to');
    const status = f.project ? `Here is where things stand: ${f.project.replace(/^[^:]+:\s*/, '')}.` : 'Here is a quick update on where things stand.';
    return {
      subject: `Update: ${f.task}`,
      body: `Hi ${first(to?.name ?? 'there')},\n\nThanks for checking in. ${status} I'll send the next piece as soon as it is ready and flag anything that needs your input.${sign}`,
      nextStep: { kind: 'task', title: `Send ${first(to?.name ?? 'them')} the next update`, nudge: `Shall I add a task to send ${first(to?.name ?? 'them')} the next update?`, toName: null, subject: '', body: '', dueDate: null, taskType: 'other' },
    };
  }
  if (type === 'schedule_meeting') {
    const to = f.person('Reply to');
    // Prefer the days (and afternoon) the requester named in the material.
    const material = (/Material \(untrusted[\s\S]*$/.exec(f.text)?.[0] ?? '').toLowerCase();
    const cands = [...f.text.matchAll(/^- (t\d+): (\w+) [^,]+, (\d{2}):\d{2}/gm)].map((m, i) => ({ id: m[1], i, score: (material.includes(m[2].toLowerCase()) ? 2 : 0) + (/afternoon/.test(material) && Number(m[3]) >= 12 ? 1 : 0) + (/morning/.test(material) && Number(m[3]) < 12 ? 1 : 0) }));
    const offered = /were already shown to the user/.test(f.text);
    const ids = offered ? cands.map((c) => c.id) : [...cands].sort((a, b) => b.score - a.score || a.i - b.i).map((c) => c.id);
    const who = first(to?.name ?? 'them');
    return {
      slotIds: ids.slice(0, 3),
      body: `Hi ${first(to?.name ?? 'there')},\n\nHappy to walk through it together. Would any of these work for you?\n\n[[TIMES]]\n\nIf none suit, send me a couple of times that do.${sign}`,
      nextStep: { kind: 'task', title: `Send ${who} the calendar invite once ${who} confirms a time`, nudge: `When ${who} picks a time, shall I remind you to send the invite?`, toName: null, subject: '', body: '', dueDate: workdaysAfter(todayOf(f.text), 1), taskType: 'other' },
    };
  }
  if (type === 'review_file') {
    const fileText = /<material label="File [^"]*">\n([\s\S]*?)\n<\/material>/.exec(f.text)?.[1];
    const lines = (f.pdf ? pdfLines(f.pdf) : (fileText ?? '').split('\n')).map((l) => l.replace(/^[#\-*\d.\s]+/, '').trim()).filter((l) => l.length > 12);
    const fileName = /The file to review: ([^\n(]+?)(?: \(|$)/m.exec(f.text)?.[1]?.split('/').pop()?.trim() ?? 'the file';
    const points = lines.filter((l) => /\d|%|\?|should|missing|propose|cost/i.test(l)).slice(0, 4);
    const keyPoints = (points.length >= 3 ? points : lines.slice(1, 5)).slice(0, 5);
    const contact = f.contacts[0];
    return {
      summary: `${fileName} sets out ${lines[0] ? lines[0].charAt(0).toLowerCase() + lines[0].slice(1) : 'the draft'}. It is a working draft with open questions for the client.`,
      keyPoints,
      nextStep: contact
        ? { kind: 'email', title: `Email ${first(contact.name)} the review notes`, nudge: `Want me to send ${first(contact.name)} your notes on ${fileName}?`, toName: contact.name, subject: `Notes on ${fileName}`, body: `Hi ${first(contact.name)},\n\nI've read ${fileName}. A few points from our side:\n\n${keyPoints.map((k) => `- ${k}`).join('\n')}\n\nHappy to talk them through.${sign}`, dueDate: null, taskType: 'other' }
        : NONE,
    };
  }
  if (type === 'follow_up') {
    const to = f.person('Chase');
    const lastSubject = /They have not answered the email "([^"]+)"/.exec(f.text)?.[1];
    return {
      subject: lastSubject ? `Re: ${lastSubject}` : `Following up: ${f.task}`,
      body: `Hi ${first(to?.name ?? 'there')},\n\n${lastSubject ? `Just following up on my email "${lastSubject}".` : `Just following up on ${f.task.replace(/^chase\s+\S+(\s+\S+)?\s*/i, '') || 'my last note'}.`} Could you let me know where things are when you get a moment?${sign}`,
      nextStep: (() => {
        const due = workdaysAfter(todayOf(f.text), 2);
        const who = first(to?.name ?? 'them');
        return { kind: 'task', title: `Check for a reply from ${who}`, nudge: `Shall I add a reminder to check for ${who}'s reply on ${WEEKDAYS[weekdayIdx(due)]}?`, toName: null, subject: '', body: '', dueDate: due, taskType: 'follow_up' };
      })(),
    };
  }
  const contact = f.contacts[0];
  return {
    summary: `This task is about ${f.task}. Start from the latest messages and the client's notes below.`,
    notes: [{ label: 'Where to start', text: f.project ?? 'Check the latest message from the client.' }],
    nextStep: contact ? { kind: 'task', title: `Let ${first(contact.name)} know "${f.task}" is done`, nudge: `Shall I add a task to tell ${first(contact.name)} it's done?`, toName: null, subject: '', body: '', dueDate: null, taskType: 'reply_email' } : NONE,
  };
}

function profile(body) {
  const u = (body.messages ?? []).map((m) => contentText(m.content)).join('\n');
  const to = /^To: ([^<\n]+)/m.exec(u)?.[1]?.trim();
  const subject = /^Subject: (.*)$/m.exec(u)?.[1];
  const date = /Now: (\d{4}-\d{2}-\d{2})/.exec(u)?.[1];
  return { edits: to && subject ? [{ section: 'Recent decisions', op: 'add', text: `${date ?? ''} replied to ${to}: ${subject}`.trim() }] : [] };
}

// ---- chat ---------------------------------------------------------------------------

function chatPlan(body) {
  const msgs = body.messages ?? [];
  const last = msgs[msgs.length - 1];
  const blocks = typeof last?.content === 'string' ? [{ type: 'text', text: last.content }] : (last?.content ?? []);
  const results = blocks.filter((b) => b.type === 'tool_result');
  const voice = /Reply mode: voice/.test(contentText(last?.content)) || blocks.some((b) => b.type === 'text' && /^\(spoken/.test(b.text));
  if (results.length) {
    const prev = msgs[msgs.length - 2];
    const uses = (prev?.content ?? []).filter((b) => b.type === 'tool_use');
    const ok = !results.some((r) => r.is_error);
    const what = uses.map((u) => u.input?.request).filter(Boolean).join(', ');
    const block = uses.some((u) => u.name === 'propose_calendar_block');
    return { text: ok ? `I've suggested ${what ? `a task to ${what.charAt(0).toLowerCase()}${what.slice(1)}` : block ? 'a focus block' : 'that'}. Approve it in your list when you're ready.` : `I couldn't set that up: ${contentText(results[0].content).slice(0, 120)}`, tool: null, slow: false };
  }
  const said = blocks.filter((b) => b.type === 'text').map((b) => b.text).pop() ?? '';
  const t = said.replace(/^\(spoken[^)]*\)\s*/i, '').trim();
  if (/\b(add|at|ad|and|create|make)\b.*\b(task|reminder)\b|\bremind me\b|^\s*chase\b/i.test(t)) {
    const request = cap(t.replace(ADD_TASK, '').replace(/[.!?]+$/, ''));
    return { text: voice ? 'Sure, one moment.' : 'Sure.', tool: { name: 'propose_create_task', input: { request } }, slow: false };
  }
  if (/\bblock\b.*\b(focus|time)\b/i.test(t)) {
    const today = todayOf(contentText(last?.content));
    let day = addDays(today, 1);
    while (weekdayIdx(day) >= 5) day = addDays(day, 1);
    return { text: 'Sure, here is a block for you to approve.', tool: { name: 'propose_calendar_block', input: { purpose: 'focus', start: `${day}T16:00:00Z`, end: `${day}T17:00:00Z`, subject: 'Focus time' } }, slow: false };
  }
  if (/\b(tell me|walk me through|explain|everything|all about|my day|long)\b/i.test(t)) {
    const n = (/My open tasks[^\n]*\n((?:- .*\n?)*)/.exec(contentText(last?.content))?.[1] ?? '').split('\n').filter((l) => l.startsWith('- ')).length;
    const sentences = [
      `Here is your day.`,
      `You have ${n} open tasks on your list, and a few of them are due today.`,
      `The most urgent is the reply about the market pricing analysis, because the client is waiting on it before their board pack closes.`,
      `After that, the driver pay draft from Harborlight needs a careful read before Thursday.`,
      `Your next meeting is the Harborlight working session, so the free time before it is a good moment for focused work.`,
      `Later in the afternoon there is the Quillon job architecture sync, which needs no preparation from you.`,
      `Tomorrow is lighter, with the comparator group meeting in the morning and the staffing review after lunch.`,
      `If you want, I can block thirty minutes for lunch and an hour of focus time for the review.`,
      `I can also draft the chasers that are waiting, so that you only need to approve them.`,
    ];
    return { text: sentences.join(' '), tool: null, slow: true };
  }
  const n = (/My open tasks[^\n]*\n((?:- .*\n?)*)/.exec(contentText(last?.content))?.[1] ?? '').split('\n').filter((l) => l.startsWith('- ')).length;
  return { text: n ? `You have ${n} open tasks. The top of Today is the best place to start.` : 'Your list is clear right now.', tool: null, slow: false };
}

// ---- usage and caching ------------------------------------------------------------------

/** Simulated prompt cache: the prefix up to the last cache_control breakpoint, hashed per model. */
function usageFor(body, seen, outText) {
  const parts = [];
  for (const t of body.tools ?? []) parts.push({ s: JSON.stringify(t), bp: !!t.cache_control });
  for (const b of typeof body.system === 'string' ? [{ type: 'text', text: body.system }] : (body.system ?? [])) parts.push({ s: JSON.stringify(b.text ?? b), bp: !!b.cache_control });
  for (const m of body.messages ?? []) {
    for (const b of typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content) parts.push({ s: JSON.stringify(b), bp: !!b.cache_control });
  }
  let lastBp = -1;
  parts.forEach((p, i) => p.bp && (lastBp = i));
  const prefix = parts.slice(0, lastBp + 1).map((p) => p.s).join('');
  const rest = parts.slice(lastBp + 1).map((p) => p.s).join('');
  const prefixTokens = tokens(prefix);
  let cache_read_input_tokens = 0;
  let cache_creation_input_tokens = 0;
  if (lastBp >= 0 && prefixTokens >= 512) {
    const key = sha(`${body.model}\u0000${prefix}`);
    if (seen.has(key)) cache_read_input_tokens = prefixTokens;
    else {
      cache_creation_input_tokens = prefixTokens;
      seen.add(key);
    }
  }
  const input_tokens = (lastBp >= 0 && prefixTokens >= 512 ? 0 : prefixTokens) + tokens(rest);
  return { input_tokens, output_tokens: tokens(outText), cache_creation_input_tokens, cache_read_input_tokens };
}

// ---- the server -----------------------------------------------------------------------

export async function startStandin({ port = 0, host = '127.0.0.1', log = null, wordDelayMs = 25, slowWordDelayMs = 70 } = {}) {
  const seen = new Set();
  const requests = [];
  let n = 0;
  const record = (r) => {
    requests.push(r);
    if (log) appendFileSync(log, `${JSON.stringify(r)}\n`);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://standin');
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'claude-standin' }));
      return;
    }
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `stand-in has no ${req.method} ${url.pathname}` } }));
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'body is not JSON' } }));
      return;
    }
    const id = `msg_standin_${++n}`;
    const call = classify(body);
    const hasKey = !!req.headers['x-api-key'];
    const entry = { ts: new Date().toISOString(), id, call, model: body.model, stream: !!body.stream, beta: req.headers['anthropic-beta'] ?? null, hasKey, effort: body.output_config?.effort ?? null };
    try {
      if (!body.stream) {
        let out;
        if (call === 'triage') out = triage(body);
        else if (call === 'prioritise') out = prioritise(body);
        else if (call === 'profile') out = profile(body);
        else if (call.startsWith('prepare:')) out = prepare(call.slice(8), body);
        else out = null;
        const text = out === null ? 'OK.' : JSON.stringify(out);
        const usage = usageFor(body, seen, text);
        record({ ...entry, usage, aborted: false });
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_${id}` });
        res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage }));
        return;
      }
      // Streaming (chat): text deltas word by word, then an optional tool_use block.
      const plan = call === 'chat' ? chatPlan(body) : { text: 'OK.', tool: null, slow: false };
      const usage = usageFor(body, seen, plan.text + (plan.tool ? JSON.stringify(plan.tool.input) : ''));
      let closed = false;
      res.on('close', () => {
        if (!res.writableFinished) closed = true;
      });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'request-id': `req_${id}` });
      const send = (event, data) => !closed && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      const words = plan.text.match(/\S+\s*/g) ?? [];
      for (const w of words) {
        if (closed) break;
        await sleep(plan.slow ? slowWordDelayMs : wordDelayMs);
        send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } });
      }
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      if (plan.tool && !closed) {
        const json = JSON.stringify(plan.tool.input);
        send('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `toolu_standin_${sha(id + json).slice(0, 16)}`, name: plan.tool.name, input: {} } });
        for (let i = 0; i < json.length && !closed; i += 12) send('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 12) } });
        send('content_block_stop', { type: 'content_block_stop', index: 1 });
      }
      send('message_delta', { type: 'message_delta', delta: { stop_reason: plan.tool ? 'tool_use' : 'end_turn', stop_sequence: null, stop_details: null }, usage: { output_tokens: usage.output_tokens } });
      send('message_stop', { type: 'message_stop' });
      record({ ...entry, usage, aborted: closed, tool: plan.tool?.name ?? null, words: words.length });
      if (!closed) res.end();
    } catch (err) {
      record({ ...entry, error: String(err?.message ?? err) });
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `stand-in error: ${err?.message ?? err}` } }));
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok());
  });
  const addr = server.address();
  return {
    url: `http://${host}:${addr.port}`,
    requests,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 7999);
  const s = await startStandin({ port });
  console.log(`[claude-standin] TEST STAND-IN (not Claude) on ${s.url}`);
}
