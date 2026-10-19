import { useEffect, useState } from 'react';
import { api, session, savedName, saveName } from './lib/api.js';
import Room from './Room.jsx';

const codeFromPath = () => location.pathname.match(/^\/(?:join|room)\/([A-Za-z0-9]+)/i)?.[1].toUpperCase() ?? null;
const cleanCode = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function App() {
  const [code, setCode] = useState(codeFromPath);
  const [entry, setEntry] = useState(null); // { name, hostKey } once the person has entered the room

  useEffect(() => {
    const onPop = () => { setCode(codeFromPath()); setEntry(null); };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const go = (path) => { history.pushState({}, '', path); setCode(codeFromPath()); setEntry(null); };

  if (code && entry) return <Room code={code} {...entry} onLeave={() => go('/')} />;
  if (code) return <Join code={code} onEnter={setEntry} onHome={() => go('/')} />;
  return <Home go={go} />;
}

function Home({ go }) {
  const [name, setName] = useState(savedName());
  const [roomName, setRoomName] = useState('');
  const [mode, setMode] = useState('everyone');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      saveName(name.trim());
      const room = await api.createRoom({ ...(roomName.trim() && { name: roomName.trim() }), controlMode: mode });
      session.set(`wp:host:${room.code}`, room.hostKey);
      go(`/join/${room.code}`);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <main className="home">
      <div className="beam" aria-hidden="true" />
      <section className="pitch">
        <h1>Press play, <em>together.</em></h1>
        <p>Spin up a room, send the link, and everyone’s screen stays on the same frame. Chat, queue, vote on what’s next.</p>
      </section>

      <section className="card">
        <form onSubmit={create} className="stack">
          <h2>Start a room</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={32} required aria-label="Your name" />
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name (optional)" maxLength={60} aria-label="Room name" />
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Who controls playback">
            <option value="everyone">Everyone controls playback</option>
            <option value="host">Only I control playback</option>
          </select>
          <button className="solid" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create room'}</button>
        </form>
        <hr />
        <form onSubmit={(e) => { e.preventDefault(); if (joinCode) go(`/join/${joinCode}`); }} className="row">
          <input value={joinCode} onChange={(e) => setJoinCode(cleanCode(e.target.value))} placeholder="Have a code?" maxLength={8} aria-label="Room code" />
          <button className="ghost" disabled={!joinCode}>Join</button>
        </form>
        {err && <p className="error">{err}</p>}
      </section>
    </main>
  );
}

function Join({ code, onEnter, onHome }) {
  const hostKey = session.get(`wp:host:${code}`) || undefined;
  const [name, setName] = useState(savedName());
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getRoom(code).then(setInfo).catch((e) => setErr(e.message));
  }, [code]);

  const enter = (n = name) => { saveName(n.trim()); onEnter({ name: n.trim(), hostKey }); };
  // The creator already typed a name on the previous screen, so drop them straight in.
  useEffect(() => { if (info && hostKey && name.trim()) enter(name); /* eslint-disable-next-line */ }, [info]);

  if (err) {
    return <main className="center"><h1>Room not found</h1><p>{err}. Codes are 6 characters and rooms close after being empty for a few minutes.</p><button className="solid" onClick={onHome}>Back home</button></main>;
  }
  return (
    <main className="center">
      <div className="card">
        <form onSubmit={(e) => { e.preventDefault(); enter(); }} className="stack">
          <h2>{info ? info.name : 'Looking for the room…'}</h2>
          {info && <p className="muted">{info.connected} watching{info.nowPlaying ? ` · now playing ${info.nowPlaying}` : ''}</p>}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={32} required autoFocus aria-label="Your name" />
          <button className="solid" disabled={!info || !name.trim()}>Join the room</button>
        </form>
      </div>
    </main>
  );
}
