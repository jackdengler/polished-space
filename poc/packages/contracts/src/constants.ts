/**
 * Ports, service names, endpoint paths and environment variable names.
 * Every service and test imports these instead of writing literals, so a
 * path changes in one place. Plan section 3.1 and section 4.
 */

/** Internal ports, inside the Docker `sandbox` network. */
export const PORTS = {
  /** Planr test copy + storage API (pm-server). */
  pmApp: 8080,
  /** MCP server, Streamable HTTP (pm-server). */
  pmMcp: 8081,
  /** Fake Outlook mail/calendar, fake Zoom chat, control page (mocks). */
  mocks: 8090,
  /** Brain HTTP API, SSE and voice WebSocket. */
  brain: 7000,
  /** Local speech-to-text and text-to-speech. */
  speech: 7100,
  /** Gateway's outbound listener that forwards to api.anthropic.com only. */
  gatewayClaude: 8443,
} as const;

/** Host ports. Bound to 127.0.0.1 only, all served through the gateway. */
export const HOST_PORTS = {
  /** Sidebar static build, plus `/api` proxied to the brain. */
  sidebar: 5180,
  /** Planr test copy (proxied to pm:8080). */
  pm: 5181,
  /** Mocks control page and fake APIs (proxied to mocks:8090). */
  mocks: 5182,
} as const;

/** Compose service names, which are also their hostnames on the sandbox network. */
export const SERVICES = {
  gateway: 'gateway',
  pm: 'pm',
  mocks: 'mocks',
  brain: 'brain',
  speech: 'speech',
} as const;

/** Default in-sandbox base URLs (override with the env vars in ENV). */
export const DEFAULT_URLS = {
  pmApp: `http://${SERVICES.pm}:${PORTS.pmApp}`,
  pmMcp: `http://${SERVICES.pm}:${PORTS.pmMcp}/mcp`,
  mocks: `http://${SERVICES.mocks}:${PORTS.mocks}`,
  speech: `http://${SERVICES.speech}:${PORTS.speech}`,
  anthropic: `http://${SERVICES.gateway}:${PORTS.gatewayClaude}`,
} as const;

/** Environment variable names read by the services. */
export const ENV = {
  /** Fixes the clock (ISO 8601 with offset, e.g. 2026-11-13T09:00:00Z). */
  now: 'POC_NOW',
  /** IANA time zone of the working day. Compose also passes it as TZ. Default UTC. */
  tz: 'POC_TZ',
  /** Root of the data folder (default: `poc/data` locally, `/data` in containers). */
  dataDir: 'POC_DATA_DIR',
  maxUsdPerDay: 'POC_MAX_USD_PER_DAY',
  anthropicKey: 'ANTHROPIC_API_KEY',
  /**
   * Where the brain sends Claude requests. POC-specific on purpose: the
   * brain never reads ANTHROPIC_BASE_URL, so an ambient value from the
   * developer's shell (or another tool) cannot redirect POC traffic.
   * Unset: https://api.anthropic.com. Compose sets the gateway.
   */
  claudeBaseUrl: 'POC_CLAUDE_BASE_URL',
  pmMcpUrl: 'PM_MCP_URL',
  mocksUrl: 'MOCKS_URL',
  speechUrl: 'SPEECH_URL',
} as const;

/** Endpoint paths. Functions build paths that carry an id. */
export const PATHS = {
  /** Brain, reached by the sidebar as same-origin `/api` (plan section 4). */
  brain: {
    state: '/api/state',
    events: '/api/events',
    approve: (id: string) => `/api/suggestions/${encodeURIComponent(id)}/approve`,
    deny: (id: string) => `/api/suggestions/${encodeURIComponent(id)}/deny`,
    input: '/api/input',
    chat: '/api/chat',
    prepared: (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}/prepared`,
    prepare: (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}/prepare`,
    /** GET `?path=<FileInfo.path>`: one client file from the fake file server, read only (FileView). */
    file: (path: string) => `/api/files?path=${encodeURIComponent(path)}`,
    files: '/api/files',
    /** GET `?path=`: the file's own bytes (PDF inline), read only. */
    fileRaw: (path: string) => `/api/files/raw?path=${encodeURIComponent(path)}`,
    filesRaw: '/api/files/raw',
    hold: (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}/hold`,
    profiles: '/api/profiles',
    profile: (clientId: string) => `/api/profiles/${encodeURIComponent(clientId)}`,
    usage: '/api/usage',
    health: '/api/health',
    voice: '/api/voice',
    /** GET: the original email or chat message behind a source link (SourceMessage), read only. */
    source: (connector: 'mail' | 'chat', id: string) => `/api/sources/${connector}/${encodeURIComponent(id)}`,
    /** GET: the one conversation's turns, typed and spoken (ConversationResponse). */
    conversation: '/api/conversation',
  },
  /** pm-server storage API on PORTS.pmApp (Planr's ServerAdapter, NOT for the brain). */
  pm: {
    workspace: '/api/workspace',
    events: '/api/events',
    logo: (name: string) => `/api/logos/${encodeURIComponent(name)}`,
    personal: (personId: string) => `/api/personal/${encodeURIComponent(personId)}`,
    health: '/api/health',
    /** MCP endpoint path on PORTS.pmMcp. */
    mcp: '/mcp',
  },
  /** Fake Microsoft Graph (mocks). */
  graph: {
    messages: '/v1.0/me/messages',
    message: (id: string) => `/v1.0/me/messages/${encodeURIComponent(id)}`,
    sendMail: '/v1.0/me/sendMail',
    /** The Sent Items folder (Graph well-known folder name `sentitems`). */
    sentMessages: '/v1.0/me/mailFolders/sentitems/messages',
    calendarView: '/v1.0/me/calendarView',
    events: '/v1.0/me/events',
  },
  /** Fake Zoom Team Chat (mocks). */
  zoom: {
    messages: '/v2/chat/users/me/messages',
  },
  /** Demo controls (mocks). Never used by the brain. */
  control: {
    mail: '/_control/mail',
    chat: '/_control/chat',
    reset: '/_control/reset',
    /** GET: the canned demo messages (CannedMessage[]). */
    canned: '/_control/canned',
    /** GET: what was "sent" (GraphMessage[]), for the control page and e2e. */
    sent: '/_control/sent',
    health: '/_control/health',
  },
  /** Speech service. */
  speech: {
    stt: '/stt',
    tts: '/tts',
    health: '/health',
  },
} as const;

/** Audio formats used by the voice path (section 6). */
export const AUDIO = {
  /** Microphone audio: PCM16 little-endian, mono, 16 kHz, 20 ms frames (640 bytes). */
  sttSampleRate: 16000,
  sttFrameMs: 20,
  /** TTS output sample rate is model-dependent; the speech service reports it in this header. */
  ttsSampleRateHeader: 'X-Sample-Rate',
} as const;

/** Name of the marker file pm-server requires in its data folder before it starts. */
export const SANDBOX_MARKER = '.poc-sandbox';

/** Layout of the data folder (section 3.1). Relative to the data dir. */
export const DATA_LAYOUT = {
  pmWorkspace: 'pm/workspace.json',
  pmMarker: `pm/${SANDBOX_MARKER}`,
  mocksMail: 'mocks/mail.json',
  mocksSent: 'mocks/sent.json',
  mocksCalendar: 'mocks/calendar.json',
  mocksChat: 'mocks/chat.json',
  mocksCanned: 'mocks/canned.json',
  files: 'files',
  profiles: 'profiles',
  brainSuggestions: 'brain/suggestions.json',
  brainTaskMeta: 'brain/taskmeta.json',
  brainCursors: 'brain/cursors.json',
  brainConversation: 'brain/conversation.json',
  usageLog: 'logs/usage.jsonl',
  /** Written by the seed: SeedInfo (ids of "me" and the Internal client, seed time). */
  seedInfo: 'seed-info.json',
} as const;
