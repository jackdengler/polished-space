// AudioWorklet: playback queue for the assistant's streamed speech. The main
// thread posts Float32 chunks already at the context's sample rate.
// `{ type: 'flush' }` drops everything queued at once (barge-in).
// Plain JS with no imports: it is loaded as-is by audioWorklet.addModule().

const Base = globalThis.AudioWorkletProcessor ?? class {};

/** FIFO of Float32 chunks read out in render quanta. */
export class PcmQueue {
  constructor() {
    this.chunks = [];
    this.offset = 0;
    this.length = 0;
  }
  push(samples) {
    if (!samples || !samples.length) return;
    this.chunks.push(samples);
    this.length += samples.length;
  }
  flush() {
    this.chunks = [];
    this.offset = 0;
    this.length = 0;
  }
  /** Fill `out`, padding with silence. Returns how many queued samples were used. */
  read(out) {
    let i = 0;
    while (i < out.length && this.chunks.length) {
      const c = this.chunks[0];
      const n = Math.min(out.length - i, c.length - this.offset);
      out.set(c.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      this.length -= n;
      if (this.offset >= c.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    out.fill(0, i);
    return i;
  }
}

export class PlaybackProcessor extends Base {
  constructor() {
    super();
    this.queue = new PcmQueue();
    this.playing = false;
    if (this.port) this.port.onmessage = (e) => this.onMessage(e.data);
  }
  post(msg) {
    if (this.port) this.port.postMessage(msg);
  }
  onMessage(m) {
    if (!m) return;
    if (m.type === 'audio') this.queue.push(m.samples);
    else if (m.type === 'flush') {
      this.queue.flush();
      if (this.playing) {
        this.playing = false;
        this.post({ type: 'drained', flushed: true });
      }
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const used = this.queue.read(out[0]);
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    if (used > 0 && !this.playing) {
      this.playing = true;
      this.post({ type: 'playing' });
    } else if (used === 0 && this.playing) {
      this.playing = false;
      this.post({ type: 'drained', flushed: false });
    }
    return true;
  }
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('pcm-playback', PlaybackProcessor);
