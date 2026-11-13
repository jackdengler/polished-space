/** PCM16 LE <-> float32 helpers. */

/** Decodes PCM16 LE bytes. `bytes.length` must be even. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function float32ToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

/**
 * Splits a byte stream into whole PCM16 samples, carrying an odd trailing
 * byte over to the next chunk (WebSocket frames need not be sample-aligned).
 */
export class Pcm16Decoder {
  private carry: number | null = null;

  push(chunk: Uint8Array): Float32Array {
    let bytes = chunk;
    if (this.carry !== null) {
      bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = this.carry;
      bytes.set(chunk, 1);
      this.carry = null;
    }
    if (bytes.length % 2 === 1) {
      this.carry = bytes[bytes.length - 1]!;
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    return pcm16ToFloat32(bytes);
  }
}

/** Fixed-capacity buffer of the most recent samples. */
export class SampleRing {
  private buf: Float32Array;
  private start = 0;
  private size = 0;

  constructor(capacity: number) {
    this.buf = new Float32Array(Math.max(0, Math.floor(capacity)));
  }

  push(samples: Float32Array): void {
    const cap = this.buf.length;
    if (cap === 0) return;
    for (let i = Math.max(0, samples.length - cap); i < samples.length; i++) {
      const end = (this.start + this.size) % cap;
      this.buf[end] = samples[i]!;
      if (this.size < cap) this.size++;
      else this.start = (this.start + 1) % cap;
    }
  }

  /** Returns the buffered samples, oldest first, and empties the ring. */
  drain(): Float32Array {
    const out = new Float32Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = this.buf[(this.start + i) % this.buf.length]!;
    this.start = 0;
    this.size = 0;
    return out;
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }
}

/** Minimal WAV (RIFF, PCM16 mono) writer and reader, for fixtures and tools. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const data = float32ToPcm16(samples);
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const len = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16) throw new Error('only PCM16 mono WAV is supported');
      return { samples: pcm16ToFloat32(bytes.subarray(o + 8, o + 8 + len)), sampleRate };
    }
    o += 8 + len + (len % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Linear resampler (good enough for feeding TTS output into STT tests). */
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const n = Math.round((x.length * to) / from);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i * from) / to;
    const j = Math.floor(p);
    const f = p - j;
    y[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return y;
}
