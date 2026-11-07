/**
 * Optional abilities granted by the claude.ai page that hosts this app.
 * Outside that page (the full app, a saved file) these resolve to null.
 */
interface DownloadsNs { save(req: { filename: string; data: string | Blob }): Promise<{ status: 'saved' | 'delivered' }> }
interface ClaudeHost { use(name: 'downloads'): Promise<DownloadsNs | null> }

export async function hostDownloads(): Promise<DownloadsNs | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host?.use) return null;
  try { return await host.use('downloads'); } catch { return null; }
}
