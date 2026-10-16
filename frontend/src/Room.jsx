import { useEffect, useState } from 'react';
import { useRoom } from './lib/useRoom.js';
import { api } from './lib/api.js';
import Player from './Player.jsx';
import { Chat, Queue, Browse, Polls, People } from './Panels.jsx';

const TABS = ['Chat', 'Queue', 'Browse', 'Polls', 'People'];

export default function Room({ code, name, hostKey, onLeave }) {
  const room = useRoom({ code, name, hostKey });
  const { client, status, error, toast } = room;
  const [tab, setTab] = useState('Chat');
  const [catalog, setCatalog] = useState(new Map());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.movies({ limit: 50 }).then((r) => setCatalog(new Map(r.items.map((m) => [m.id, m])))).catch(() => {});
  }, []);

  if (status === 'failed' || status === 'closed') {
    return (
      <main className="center">
        <h1>{status === 'failed' ? 'Couldn’t join the room' : 'Disconnected'}</h1>
        <p>{error || 'The connection to the room was lost.'}</p>
        <button className="solid" onClick={onLeave}>Back home</button>
      </main>
    );
  }
  if (!client?.identity) return <main className="center"><p>Connecting to {code}…</p></main>;

  const canControl = client.settings?.controlMode === 'everyone' || client.isHost;
  const { items, currentId } = client.playlist;
  const item = items.find((i) => i.id === currentId) ?? null;
  const movie = item?.movieId ? catalog.get(item.movieId) : null;
  const invite = `${location.origin}/join/${code}`;
  const online = [...client.participants.values()].filter((p) => p.connected).length;

  const copy = () => navigator.clipboard?.writeText(invite).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });

  return (
    <div className="room">
      <header>
        <div>
          <h1>{client.settings?.name || 'Watch party'}</h1>
          <span className={`status ${status}`}>{status === 'live' ? `${online} watching` : 'Reconnecting…'}</span>
        </div>
        <div className="row">
          <button className="ghost" onClick={copy}>{copied ? 'Link copied' : `Invite · ${code}`}</button>
          <button className="ghost" onClick={() => { client.leave().catch(() => client.close()); onLeave(); }}>Leave</button>
        </div>
      </header>

      <div className="layout">
        <Player room={room} item={item} movie={movie} canControl={canControl} />
        <aside>
          <nav role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t}{t === 'Queue' && items.length ? ` ${items.length}` : ''}
              </button>
            ))}
          </nav>
          {tab === 'Chat' && <Chat room={room} />}
          {tab === 'Queue' && <Queue room={room} canControl={canControl} />}
          {tab === 'Browse' && <Browse room={room} canControl={canControl} currentMovieId={item?.movieId} />}
          {tab === 'Polls' && <Polls room={room} />}
          {tab === 'People' && <People room={room} />}
        </aside>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
