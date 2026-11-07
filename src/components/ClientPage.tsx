import { useEffect } from 'react';
import { defaultMeeting } from '../model/derive';
import { ADHOC, type Client } from '../model/schema';
import { navigate, type Route } from '../router';
import { useStore } from '../store/store';
import { Board } from './Board';
import { ClientHeader } from './ClientHeader';
import { Timeline } from './Timeline';

export function ClientPage({ client, route }: { client: Client; route: Route }) {
  const boardExists = route.boardId === ADHOC || client.meetings.some((m) => m.id === route.boardId);

  // No (or a deleted) board in the URL → open the next upcoming meeting, else ad-hoc.
  useEffect(() => {
    if (!boardExists) navigate({ clientId: client.id, boardId: defaultMeeting(client)?.id ?? ADHOC }, { replace: true });
  }, [boardExists, client]);

  return (
    <div className="client-page">
      {client.archived && (
        <div className="banner">
          This client is archived.
          <button className="btn btn-sm" onClick={() => useStore.getState().setArchived(client.id, false)}>Unarchive</button>
        </div>
      )}
      <ClientHeader client={client} />
      <Timeline client={client} boardId={boardExists ? route.boardId : null} />
      {boardExists && <Board key={route.boardId} client={client} boardId={route.boardId!} highlightTaskId={route.taskId} />}
    </div>
  );
}
