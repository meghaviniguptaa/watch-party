import { useEffect, useRef, useState } from 'react';
import { WatchPartyClient } from './WatchPartyClient.js';
import { SyncPlayer } from './SyncPlayer.js';
import { wsUrl, session } from './api.js';

const TICK_EVENTS = ['joined', 'state', 'sync', 'participant', 'host', 'chat', 'playlist', 'poll', 'settings'];

export function useRoom({ code, name, hostKey }) {
  const [, setTick] = useState(0);
  const [status, setStatus] = useState('connecting'); // connecting | live | reconnecting | closed | failed
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [blocked, setBlocked] = useState(false);
  const ref = useRef({ client: null, player: new SyncPlayer(), drift: 0 });

  useEffect(() => {
    const { player } = ref.current;
    const idKey = `wp:id:${code}`;
    const client = new WatchPartyClient({ url: wsUrl(), room: code, name, hostKey, player });
    const saved = session.get(idKey);
    if (saved) client.identity = saved; // resume the same participant after a refresh
    ref.current.client = client;
    player.onBlockedChange = setBlocked;

    const bump = () => setTick((n) => n + 1);
    const flash = (msg) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500); };
    const offs = TICK_EVENTS.map((e) => client.on(e, bump));
    offs.push(
      client.on('joined', () => { session.set(idKey, client.identity); setStatus('live'); }),
      client.on('drift', (d) => { ref.current.drift = d.driftMs; }),
      client.on('disconnected', () => setStatus((s) => (s === 'failed' || s === 'closed' ? s : 'reconnecting'))),
      client.on('reconnected', () => setStatus('live')),
      client.on('closed', () => setStatus('closed')),
      client.on('error', (e) => flash(e.message)),
      client.on('reaction', (r) => {
        const item = { id: `${r.ts}-${Math.random()}`, emoji: r.emoji, name: r.name, x: 10 + Math.random() * 80 };
        setReactions((l) => [...l.slice(-12), item]);
        setTimeout(() => setReactions((l) => l.filter((x) => x.id !== item.id)), 3200);
      }),
    );

    client.connect().catch((e) => { setError(e.message); setStatus('failed'); });
    return () => { offs.forEach((off) => off()); client.close(); };
  }, [code, name, hostKey]);

  // Run an action and surface server-side rejections (e.g. "Only the host can control playback").
  const act = (promise) => promise.catch((e) => { setToast(e.message); setTimeout(() => setToast(null), 3500); });

  return { ...ref.current, status, error, toast, reactions, blocked, act };
}
