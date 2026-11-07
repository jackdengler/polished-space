import { useEffect, useState } from 'react';
import { colorFor, initials } from '../model/derive';
import type { Client, TeamMember } from '../model/schema';
import { usePersistence } from '../storage/persistence';

export function Avatar({ member, size = 22 }: { member: TeamMember; size?: number }) {
  return (
    <span className="avatar" title={member.name} style={{ background: member.color, width: size, height: size, fontSize: size * 0.42 }}>
      {initials(member.name)}
    </span>
  );
}

const logoUrls = new Map<string, string>();

/** Object URL for a logo file in the workspace (cached). */
export function useLogoUrl(fileName: string | null): string | null {
  const adapter = usePersistence((s) => s.adapter);
  const [url, setUrl] = useState<string | null>(fileName ? logoUrls.get(fileName) ?? null : null);
  useEffect(() => {
    if (!fileName || !adapter) { setUrl(null); return; }
    const hit = logoUrls.get(fileName);
    if (hit) { setUrl(hit); return; }
    let live = true;
    void adapter.readLogo(fileName).then((blob) => {
      if (!blob) { if (live) setUrl(null); return; }
      const u = URL.createObjectURL(blob);
      logoUrls.set(fileName, u);
      if (live) setUrl(u);
    });
    return () => { live = false; };
  }, [fileName, adapter]);
  return url;
}

export function ClientLogo({ client, size = 28 }: { client: Client; size?: number }) {
  const url = useLogoUrl(client.logo);
  if (url) return <img className="client-logo" src={url} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="client-logo fallback" aria-hidden="true"
      style={{ width: size, height: size, background: colorFor(client.name), fontSize: size * 0.4 }}>
      {initials(client.name)}
    </span>
  );
}

/** Shrink an uploaded image to fit in max×max and return it as PNG. */
export async function imageToPng(file: Blob, max = 256): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
    const w = Math.max(1, Math.round((img.naturalWidth || max) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || max) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read image'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
