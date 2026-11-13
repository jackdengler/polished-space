/** ChatConnector over the fake Zoom Team Chat ("List user's chat messages" shape). */
import { PATHS, ZoomChatMessageList, type ChatConnector, type ChatMessage } from '@poc/contracts';
import { httpJson, joinUrl } from './http';

const MAX_PAGES = 20;

export class ZoomChatConnector implements ChatConnector {
  constructor(private baseUrl: string) {}

  async listSince(cursor: string): Promise<{ items: ChatMessage[]; cursor: string }> {
    const items: ChatMessage[] = [];
    let token = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ page_size: '50' });
      if (cursor) q.set('from', cursor);
      if (token) q.set('next_page_token', token);
      const list = ZoomChatMessageList.parse(await httpJson(`${joinUrl(this.baseUrl, PATHS.zoom.messages)}?${q}`));
      items.push(...list.messages);
      token = list.next_page_token;
      if (!token) break;
    }
    // Zoom's `from` is inclusive; the connector rule is strictly after the cursor.
    const after = cursor ? Date.parse(cursor) : -Infinity;
    const picked = items.filter((m) => Date.parse(m.date_time) > after).sort((a, b) => Date.parse(a.date_time) - Date.parse(b.date_time));
    return { items: picked, cursor: picked.length ? picked[picked.length - 1]!.date_time : cursor };
  }
}
