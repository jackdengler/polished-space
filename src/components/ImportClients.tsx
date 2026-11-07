import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { convertLegacyClients, type ImportResult } from '../import/legacy';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { dataUrlToBlob } from '../storage/blobs';
import { usePersistence } from '../storage/persistence';
import { imageToPng } from './Avatar';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface ImportHandle { open(): void }

/** "Import clients…": reads client JSON files from the previous tracker and adds them. */
export const ImportClients = forwardRef<ImportHandle>(function ImportClients(_props, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }));
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files: { name: string; data: unknown }[] = [];
    const unreadable: ImportResult['skipped'] = [];
    for (const f of Array.from(list)) {
      try { files.push({ name: f.name, data: JSON.parse(await f.text()) }); }
      catch { unreadable.push({ file: f.name, reason: "isn't valid JSON" }); }
    }
    const store = useStore.getState();
    const r = convertLegacyClients(files, store.ws);
    r.skipped.unshift(...unreadable);

    // Store logos first so the clients point at saved files.
    const adapter = usePersistence.getState().adapter;
    if (adapter) {
      for (const { clientId, dataUrl } of r.logos) {
        try {
          const raw = dataUrlToBlob(dataUrl);
          const png = await imageToPng(raw).catch(() => raw);
          const name = await adapter.writeLogo(clientId, png);
          const c = r.clients.find((x) => x.id === clientId);
          if (c) c.logo = name;
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }
    if (r.clients.length) {
      store.importClients(r.clients, r.newMembers);
      navigate({ clientId: r.clients.find((c) => !c.archived)?.id ?? r.clients[0]!.id });
    }
    setResult(r);
  }

  return (
    <>
      <input ref={input} type="file" accept=".json,application/json" multiple hidden aria-label="Client files to import"
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
      {result && (
        <Modal title={result.clients.length ? `Imported ${result.clients.length} client${result.clients.length === 1 ? '' : 's'}` : 'Nothing imported'} onClose={() => setResult(null)} width={480}>
          {result.summary.length > 0 && (
            <ul className="import-list">
              {result.summary.map((s) => <li key={s.name}><b>{s.name}</b><span className="muted">{s.meetings} meetings · {s.tasks} tasks</span></li>)}
            </ul>
          )}
          {result.newMembers.length > 0 && <p className="modal-text">Added {result.newMembers.length} people to the team list.</p>}
          {result.skipped.length > 0 && (
            <div className="import-skipped">
              <b>Skipped</b>
              <ul>{result.skipped.map((s) => <li key={s.file}>{s.file}: {s.reason}</li>)}</ul>
            </div>
          )}
          {error && <p className="welcome-error" role="alert"><Icon name="alert" size={14} /> {error}</p>}
          {result.clients.length > 0 && (
            <p className="modal-text small">
              Meeting names that were dates ("9/2/25", "Fall 2026") became the meeting's date.
              Not carried over: time tracking, edit history, colors, buckets, calendars and staffing levels.
            </p>
          )}
          <div className="modal-actions"><button className="btn btn-primary" autoFocus onClick={() => setResult(null)}>Done</button></div>
        </Modal>
      )}
    </>
  );
});
