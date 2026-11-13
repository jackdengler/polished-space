/** CalendarConnector over the fake Outlook calendar (Graph `calendarView` and `events`). */
import { CalEvent, CalEventList, NewCalEvent, PATHS, eventSpanMs, type CalendarConnector } from '@poc/contracts';
import { httpJson, joinUrl } from './http';

export class GraphCalendarConnector implements CalendarConnector {
  constructor(private baseUrl: string) {}

  async view(startIso: string, endIso: string): Promise<CalEvent[]> {
    const q = new URLSearchParams({ startDateTime: startIso, endDateTime: endIso });
    const list = CalEventList.parse(await httpJson(`${joinUrl(this.baseUrl, PATHS.graph.calendarView)}?${q}`));
    return list.value.sort((a, b) => eventSpanMs(a).start - eventSpanMs(b).start);
  }

  async createEvent(e: NewCalEvent): Promise<CalEvent> {
    return CalEvent.parse(await httpJson(joinUrl(this.baseUrl, PATHS.graph.events), { method: 'POST', body: NewCalEvent.parse(e) }));
  }
}
