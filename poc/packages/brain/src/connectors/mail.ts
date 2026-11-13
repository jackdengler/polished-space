/**
 * MailConnector over the fake Outlook (Microsoft Graph v1.0 shape) in mocks.
 * V1 swaps the base URL and adds auth; the brain does not change.
 */
import { randomUUID } from 'node:crypto';
import { GraphMessage, GraphMessageList, PATHS, draftToSendMail, type MailConnector, type MailDraft, type MailMessage } from '@poc/contracts';
import { http, httpJson, joinUrl } from './http';

const MAX_PAGES = 20;

export class GraphMailConnector implements MailConnector {
  constructor(private baseUrl: string) {}

  async listSince(cursor: string): Promise<{ items: MailMessage[]; cursor: string }> {
    const q = new URLSearchParams({ $orderby: 'receivedDateTime asc', $top: '50' });
    if (cursor) q.set('$filter', `receivedDateTime gt ${cursor}`);
    let url: string | undefined = `${joinUrl(this.baseUrl, PATHS.graph.messages)}?${q}`;
    const items: MailMessage[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const list = GraphMessageList.parse(await httpJson(url));
      items.push(...list.value);
      const next: string | undefined = list['@odata.nextLink'];
      url = next ? (next.startsWith('http') ? next : joinUrl(this.baseUrl, next)) : undefined;
    }
    // Defensive: keep the "strictly after, oldest first" rule even if a server is loose about it.
    const after = cursor ? Date.parse(cursor) : -Infinity;
    const picked = items.filter((m) => Date.parse(m.receivedDateTime) > after).sort((a, b) => Date.parse(a.receivedDateTime) - Date.parse(b.receivedDateTime));
    return { items: picked, cursor: picked.length ? picked[picked.length - 1]!.receivedDateTime : cursor };
  }

  async get(id: string): Promise<MailMessage> {
    return GraphMessage.parse(await httpJson(joinUrl(this.baseUrl, PATHS.graph.message(id))));
  }

  /**
   * Graph `sendMail` answers 202 with no body, so there is no message id to
   * return. The mock may name the Sent item in a `location` or `x-message-id`
   * header; otherwise a local id is returned (only used for logs).
   */
  async send(draft: MailDraft): Promise<{ id: string }> {
    const res = await http(joinUrl(this.baseUrl, PATHS.graph.sendMail), { method: 'POST', body: draftToSendMail(draft) });
    const header = res.headers.get('x-message-id') ?? res.headers.get('location')?.split('/').pop() ?? null;
    return { id: header || `sent-${randomUUID()}` };
  }
}
