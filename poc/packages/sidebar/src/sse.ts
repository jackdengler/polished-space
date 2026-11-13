/**
 * A small Server-Sent Events parser for streams read with `fetch`
 * (`POST /api/chat` answers with an SSE body, which `EventSource` cannot
 * send a POST for). Follows the WHATWG rules the brain relies on:
 * `event:` and `data:` fields, multi-line data joined with "\n", a blank
 * line ends an event, lines starting with ":" are comments.
 */

export interface SseMessage {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];

  /** Feed the next chunk of text; returns the events it completed. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let nl: number;
    while ((nl = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      // A lone "\r" at the end may be the first half of "\r\n": wait for more.
      if (this.buffer[nl] === '\r' && nl === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, nl);
      const sepLen = this.buffer.startsWith('\r\n', nl) ? 2 : 1;
      this.buffer = this.buffer.slice(nl + sepLen);
      this.line(line, out);
    }
    return out;
  }

  /** Flush a trailing event that was not followed by a blank line. */
  end(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer) this.line(this.buffer, out);
    this.buffer = '';
    this.line('', out);
    return out;
  }

  private line(line: string, out: SseMessage[]): void {
    if (line === '') {
      if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n') });
      this.event = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
  }
}

/** Read an SSE response body to the end, calling `onMessage` for each event. */
export async function readSse(body: ReadableStream<Uint8Array>, onMessage: (m: SseMessage) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const m of parser.push(decoder.decode(value, { stream: true }))) onMessage(m);
    }
    for (const m of parser.push(decoder.decode())) onMessage(m);
    for (const m of parser.end()) onMessage(m);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
