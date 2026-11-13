import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav, float32ToPcm16, Pcm16Decoder, pcm16ToFloat32, resampleLinear, SampleRing } from './pcm';

describe('pcm helpers', () => {
  it('round-trips float32 through PCM16 LE', () => {
    const x = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const bytes = float32ToPcm16(x);
    expect(bytes.length).toBe(14);
    expect(bytes[2]).toBe(0x00); // 0.5 * 32767 = 16384 (rounded) -> 0x4000 little-endian
    expect(bytes[3]).toBe(0x40);
    const y = pcm16ToFloat32(bytes);
    expect(y[1]).toBeCloseTo(0.5, 3);
    expect(y[2]).toBeCloseTo(-0.5, 3);
    expect(y[5]).toBeCloseTo(1, 3); // clipped
    expect(y[6]).toBe(-1);
  });

  it('carries an odd byte across chunks', () => {
    const all = float32ToPcm16(new Float32Array([0.1, 0.2, 0.3]));
    const d = new Pcm16Decoder();
    const a = d.push(all.subarray(0, 3));
    const b = d.push(all.subarray(3));
    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
    expect(b[1]).toBeCloseTo(0.3, 3);
  });

  it('keeps only the newest samples in the ring', () => {
    const r = new SampleRing(3);
    r.push(new Float32Array([1, 2]));
    r.push(new Float32Array([3, 4, 5]));
    expect(Array.from(r.drain())).toEqual([3, 4, 5]);
    expect(r.drain().length).toBe(0);
    r.push(new Float32Array([6]));
    expect(Array.from(r.drain())).toEqual([6]);
  });

  it('writes and reads a WAV', () => {
    const x = new Float32Array([0, 0.25, -0.25]);
    const { samples, sampleRate } = decodeWav(encodeWav(x, 16000));
    expect(sampleRate).toBe(16000);
    expect(samples[1]).toBeCloseTo(0.25, 3);
  });

  it('resamples by the rate ratio', () => {
    expect(resampleLinear(new Float32Array(22050), 22050, 16000).length).toBe(16000);
  });
});
