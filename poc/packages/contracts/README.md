# @poc/contracts

The shapes every POC piece codes against: zod schemas with inferred types,
connector interfaces, endpoint and port constants, and test fakes. Source
only, no build step (TypeScript is run by `tsx` and type-checked by `tsc`).

```ts
import { Suggestion, PATHS, PORTS, sectionKeyFor, type MailConnector } from '@poc/contracts';
import { FakeClaude, FakePmConnector, SAMPLES } from '@poc/contracts/testing'; // tests only
```

Add it to a package with `"@poc/contracts": "*"` in `dependencies` (already
done for every workspace package).

## Files

| File | What |
|---|---|
| `constants.ts` | `PORTS`, `HOST_PORTS`, `SERVICES`, `DEFAULT_URLS`, `ENV` names, `PATHS` (brain, pm, Graph, Zoom, control, speech), `AUDIO`, `SANDBOX_MARKER`, `DATA_LAYOUT` |
| `common.ts` | `IsoDate`, `IsoDateTime`, `SourceRef`, `TaskType`, `Direction`, `ClientConfidence`, `Person`, `TimeSlot`, `Health`, `ErrorBody` |
| `time.ts` | `resolveNow(POC_NOW)`, `localDate`, `localMinutes`, `zonedTime`, `addDaysIso`, `weekdayIndex`, `weekStart`, `weekdayName`, `nextWeekday` |
| `mail.ts` | Graph `message` (`GraphMessage` = `MailMessage`), list and `sendMail` bodies, `MailDraft`, `draftToSendMail`, `makeBodyPreview` |
| `calendar.ts` | Graph `event` (`CalEvent`), `NewCalEvent`, `toGraphDateTime` / `fromGraphDateTime`, `eventSpanMs` |
| `chat.ts` | Zoom chat message (`ZoomChatMessage` = `ChatMessage`) and list response |
| `files.ts` | `FileInfo`, `FileContent`, `mimeTypeFor` |
| `pm.ts` | The five MCP tools: input and output schemas, `MCP_TOOL_NAMES`, `MCP_WRITE_TOOLS`, `MCP_TOOLS` table, `PmClient`, `PmTask`, `FlexDate` |
| `suggestions.ts` | `Suggestion` (discriminated by `kind`, typed `payload` per kind), `ApproveBody`, `PreparedWork`, `TaskMeta`, `ProfileEdit`, other brain request/response bodies |
| `sidebar.ts` | `SidebarState`, `SidebarTask`, `Nudge`, section keys and `sectionKeyFor` / `sectionKeys` / `sectionLabel`, SSE event tables for `/api/events` and `/api/chat` |
| `usage.ts` | `UsageLine` (one `usage.jsonl` line), `UsageSummary`, `summariseUsage` |
| `profile.ts` | Profile headings, `profileSlug`, `renderProfile`, `parseProfile`, profile endpoint bodies |
| `voice.ts` | `WS /api/voice` messages, speech `SttEvent`, `TtsRequest` |
| `control.ts` | Mocks control bodies (`ControlMailDrop`, `ControlChatDrop`), `CannedMessage`, `SeedInfo` |
| `connectors.ts` | `MailConnector`, `CalendarConnector`, `ChatConnector`, `FilesConnector`, `PmConnector`, `SpeechToText`/`SttStream`, `TextToSpeech` |
| `testing/` | `FakeClaude`, in-memory fake for every connector, `SAMPLES` (one valid and one invalid value per schema) |

## Decisions made here (the plan left these open)

**General**

- Every timestamp the POC owns is ISO 8601 with an offset or `Z` (`IsoDateTime`). Dates are `YYYY-MM-DD`.
- "Now" is `POC_NOW` if set, else the clock (`resolveNow`). The working day is in one IANA zone, `POC_TZ` (default `UTC`); compose passes it to every container (also as `TZ`). Weeks run Monday to Sunday.
- Error bodies are `{ error: string }`. Health endpoints return `{ ok, service, now }`. Extra health paths: `PATHS.pm.health`, `PATHS.control.health`, `PATHS.speech.health` (the brain's is in the plan).

**Fake sources**

- Graph `body.contentType` is lower-case `text` or `html` (what Graph returns).
- Calendar times: the mock always uses `timeZone: "UTC"`; `toGraphDateTime` / `fromGraphDateTime` convert. Other zones throw.
- `sendMail` returns 202 with no body (like Graph). `MailConnector.send` still returns `{ id }`: the mock's id for the item in Sent.
- `MailDraft` is the POC's own shape (plain text body, `Person` recipients, `replyToMessageId`). Graph has no "reply to" field on `sendMail`, so it is not sent; the subject says "Re: ...".
- Zoom: real Zoom lists one conversation at a time and needs `to_contact` or `to_channel`. The mock accepts just `from` and returns all of the user's chats, oldest first. In a 1:1 chat, `to_contact` is the *other* person (as seen from "me"). `channel_name` is a mock-only extra for labels. Messages sent by "me" appear too; the brain skips them.
- Cursor rule for `listSince`: opaque string, `''` = from the start, returns items strictly after the cursor, oldest first. The POC uses the last item's timestamp. `/_control/mail` always stamps a dropped message later than the newest stored one, so `gt` never misses it.
- Sent folder: `MailConnector.listSent()` reads Graph `GET /v1.0/me/mailFolders/sentitems/messages` (oldest first). Read only; the brain uses it to quote the unanswered email in a follow-up chaser.
- Extra control endpoints: `GET /_control/canned` (the canned messages) and `GET /_control/sent` (the Sent folder), for the control page and e2e.
- `FileContent`: text types are `utf8`, PDFs are `base64` (ready for a Claude document block). Only `.txt`, `.md`, `.csv`, `.pdf` exist.
- `GET /api/files?path=` (brain, read only) returns `FileView`: the file's info plus its text (`textSource: 'file'`), or for a PDF the text taken from its content streams (`'pdf_text'`, layout not kept), capped at `FILE_VIEW_MAX_CHARS`, and `rawUrl` = `GET /api/files/raw?path=` which serves the file itself (PDF inline). Paths outside the fake file server are a 400. The sidebar shows it in the file-review view.

**PM / MCP**

- Tool results are returned as MCP `structuredContent` and also as one JSON text block.
- `create_task` defaults `assigneeIds` to `[]` at the MCP level; the brain always passes `[me]`.
- `list_tasks`: when `dueFrom` or `dueTo` is given, undated tasks are left out. Both bounds are inclusive.
- `list_clients.projects` are Planr meetings (not the ad-hoc area); `date` is Planr's `FlexDate`.

**Suggestions and approval**

- `Suggestion.payload` is typed per `kind` (`PAYLOAD_SCHEMAS`). `create_task` needs `clientId` set before it can be approved.
- `duplicateOf` is an object `{ kind: 'task' | 'suggestion', id }` (the plan had a bare string, which could not say which).
- `ApproveBody.edits`: `title`, `clientId`, and `payload` (shallow-merged over the suggestion's payload, then re-validated; 400 if invalid). For `send_reply`, pass the whole edited draft as `payload.draft`.
- `send_reply` completes `payload.taskId` (if set) after the send succeeds.
- `confirm_client`: approve needs `edits.clientId` (or exactly one candidate). The brain then sets that client on `relatedSuggestionIds` (still pending) and records `alias` under "Also known as" in that client's profile.
- **Approving prepared work** goes through the same approve endpoint: when prepared work is ready, the brain also creates one pending suggestion for it (`send_reply` for reply, meeting and follow-up drafts; `complete_task` for file review and "other") and stores its id in `TaskMeta.preparedSuggestionId`. The plan listed no endpoint for this; this keeps exactly one write path.
- A follow-on "next step" suggestion has `source.connector = 'next_step'` and `source.id` = the task whose prepared work was approved. (`next_step` is added to the plan's connector list.)
- `TaskMeta` gains `preparedStatus` (`none | preparing | ready | failed`) and `preparedSuggestionId`. `source` may be null.
- Approve and deny respond with `{ suggestion }` after the decision.

**Sidebar**

- Section keys: `inbox`, `on_hold`, `overdue`, `today`, `tomorrow`, `day-YYYY-MM-DD` (each remaining day of this week, after tomorrow, up to Sunday), `next_week`, `next_week_1`, `next_week_2`, `later`, `internal`. `sectionKeyFor` is the single rule.
- Added a `later` section for dated tasks beyond "Next week +2", so nothing disappears (empty in the demo).
- Precedence: on hold, then Internal client, then undated (Inbox), then by date.
- `SidebarState` also carries `today`, `me` and `clients` (for the client picker). `suggestions` holds pending and failed only, newest first. `nudges` newest first, at most 20. Every section is present even when empty.
- `Nudge.kind`: `new_item`, `fit_now` (with `taskId`), `info`.
- The brain's Claude endpoint is `POC_CLAUDE_BASE_URL` (`ENV.claudeBaseUrl`; default `https://api.anthropic.com`; compose sets the gateway). The brain never reads `ANTHROPIC_BASE_URL`.
- `POST /api/input` responds `{ suggestions }`. `GET /api/usage` responds `{ today, days }`. `GET /api/profiles` responds `{ profiles }`.

**Voice**

- TTS output sample rate is model-dependent: the speech service sends it in the `X-Sample-Rate` header, and the brain passes it on in `assistant.audio.start { sampleRate }`. Microphone audio is always PCM16 LE mono 16 kHz.
- `interrupted` carries `spokenText` (what stays in history). An `error` message type exists on the voice socket.

**Profiles**

- Section bodies are bullet lists. Empty sections render as `- (none yet)`. Only code writes `## Change log` (one bullet per change, ISO time first). `parseProfile` keeps unknown `##` sections a person added (`extra`), so a rewrite can preserve them. Internal has no profile.

**Seed** (see `poc/seed/`)

- Stable ids: `poc-client-acme`, `poc-client-harborlight`, `poc-client-quillon`, `poc-client-tessera`, `poc-client-internal`; me = `poc-member-alex`.
- `data/seed-info.json` (`SeedInfo`) gives `me`, `internalClientId` and `intakeCursor` (= seed "now"): start mail and chat intake there so seeded history is context, not new work.
- Mocks data files are plain arrays (`mail.json`, `sent.json`, `calendar.json`, `chat.json`) plus `canned.json`. Pristine copies sit in `data/mocks/initial/` for `/_control/reset`.
- `CannedMessage.expect` records what the brain should do (client, confidence, task types, directions, duplicate). An empty list means "not asserted".

## Test fakes

- `FakeClaude`: `enqueue(...replies)`, `setDefault(fn)`, `calls` (method, params, options, `aborted`), `totalUsage`. Implements `messages.create`, `messages.parse` (returns `parsed_output`) and `messages.stream` (raw events, `on('text')`, `finalMessage()`, `abort()`, honours `options.signal`). The brain's `claude.ts` should stick to these so the fake drops in. A `chunkDelayMs` on a reply lets a test abort mid-stream.
- `FakeMailConnector`, `FakeCalendarConnector`, `FakeChatConnector`, `FakeFilesConnector`, `FakePmConnector` (`writeCalls` lists create/complete/reschedule calls), `FakeSpeechToText` (drive with `stream.emit(event)`), `FakeTextToSpeech` (abortable).

## Commands (run from the repo root)

```sh
npm ci                          # root deps: the seed tests import Planr's src/model/schema.ts
npm --prefix poc ci             # POC workspaces
npm --prefix poc run typecheck  # every workspace
npm --prefix poc test           # vitest, every workspace
npm --prefix poc run seed       # writes poc/data/ (POC_NOW, POC_TZ, POC_DATA_DIR optional)
docker compose -f poc/docker-compose.yml config
```
