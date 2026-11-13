import { colorFor } from '../model/derive';

/**
 * A client's color for the day timeline: the dominant non-white color of its
 * logo, with a readable text color. Falls back to a stable color from the name.
 */
const cache = new Map<string, { bg: string; fg: string }>();

export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#18181b' : '#ffffff';
}

export function fallbackColor(name: string) {
  const bg = colorFor(name);
  return { bg, fg: textOn(bg) };
}

export async function logoColor(key: string, url: string | null, name: string): Promise<{ bg: string; fg: string }> {
  const hit = cache.get(key);
  if (hit) return hit;
  let result = fallbackColor(name);
  if (url) {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 32, 32);
      const px = ctx.getImageData(0, 0, 32, 32).data;
      const buckets = new Map<string, number>();
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b, a] = [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
        if (a < 128 || (r > 225 && g > 225 && b > 225) || Math.max(r, g, b) - Math.min(r, g, b) < 12 && r > 200) continue; // skip transparent/white/near-white greys
        const k = [r, g, b].map((v) => Math.round(v / 32) * 32).join(',');
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      const top = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) {
        const [r, g, b] = top[0].split(',').map((v) => Math.min(255, Number(v)));
        const bg = `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
        result = { bg, fg: textOn(bg) };
      }
    } catch { /* keep the fallback */ }
  }
  cache.set(key, result);
  return result;
}
