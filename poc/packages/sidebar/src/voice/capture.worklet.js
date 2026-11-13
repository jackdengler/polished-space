// AudioWorklet: microphone capture. Turns the context's audio (any sample
// rate) into PCM16 little-endian mono at 16 kHz, posted to the main thread in
// 20 ms frames (320 samples = 640 bytes), as the voice contract asks.
// Plain JS with no imports: it is loaded as-is by audioWorklet.addModule().

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320;
const Base = globalThis.AudioWorkletProcessor ?? class {};

export class CaptureProcessor extends Base {
  /** @param {{ inputRate?: number, emit?: (buf: ArrayBuffer) => void }} [opts] */
  constructor(opts) {
    super();
    const inputRate = opts?.inputRate ?? globalThis.sampleRate ?? 48000;
    this.ratio = inputRate / TARGET_RATE;
    this.phase = 0;
    this.acc = 0;
    this.cnt = 0;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.n = 0;
    this.active = true;
    this.emit = opts?.emit ?? ((buf) => this.port.postMessage(buf, [buf]));
    if (this.port) {
      this.port.onmessage = (e) => {
        if (e.data && e.data.type === 'stop') this.active = false;
      };
    }
  }

  /** Push mono float samples (-1..1) at the input rate. */
  write(samples) {
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      this.acc += x;
      this.cnt += 1;
      this.phase += 1;
      // Box-filter downsampling: average the input samples that fall into each output sample.
      while (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const v = this.cnt ? this.acc / this.cnt : x;
        this.acc = 0;
        this.cnt = 0;
        const c = Math.max(-1, Math.min(1, v));
        this.frame[this.n++] = c < 0 ? c * 0x8000 : c * 0x7fff;
        if (this.n === FRAME_SAMPLES) {
          const buf = this.frame.buffer;
          this.frame = new Int16Array(FRAME_SAMPLES);
          this.n = 0;
          this.emit(buf);
        }
      }
    }
  }

  process(inputs) {
    if (!this.active) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.write(ch);
    return true;
  }
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('pcm-capture', CaptureProcessor);
