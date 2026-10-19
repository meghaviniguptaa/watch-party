import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';

const nameOf = (client, id) => client.participants.get(id)?.name ?? 'someone';

/* ---------------- Chat ---------------- */
export function Chat({ room }) {
  const { client, act } = room;
  const [text, setText] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [client.chat.length]);
  const send = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    act(client.sendChat(t));
  };
  return (
    <div className="pane chat">
      <ul className="log">
        {client.chat.length === 0 && <li className="empty">No messages yet. Say something.</li>}
        {client.chat.map((m) => (
          <li key={m.id} className={m.from.id === client.identity.id ? 'mine' : ''}>
            <b>{m.from.id === client.identity.id ? 'You' : m.from.name}</b>
            <span>{m.text}</span>
          </li>
        ))}
        <li ref={end} />
      </ul>
      <form onSubmit={send} className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message the room" aria-label="Message" />
        <button className="solid" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}

/* ---------------- Queue ---------------- */
export function Queue({ room, canControl }) {
  const { client, act } = room;
  const { items, currentId } = client.playlist;
  const mayRemove = (i) => i.addedBy === client.identity.id || client.isHost;
  return (
    <div className="pane">
      {items.length === 0 && <p className="empty">The queue is empty. Add something from Browse.</p>}
      <ol className="queue">
        {items.map((it, idx) => (
          <li key={it.id} className={it.id === currentId ? 'current' : ''}>
            <div className="meta">
              <strong>{it.title}</strong>
              <small>{it.id === currentId ? 'Now playing · ' : ''}added by {nameOf(client, it.addedBy)}</small>
            </div>
            <div className="btns">
              <button className="ghost" disabled={!canControl || it.id === currentId} onClick={() => act(client.playlistPlay(it.id))}>Play</button>
              <button className="ghost" aria-label="Move up" disabled={idx === 0} onClick={() => act(client.playlistMove(it.id, idx - 1))}>↑</button>
              <button className="ghost" aria-label="Move down" disabled={idx === items.length - 1} onClick={() => act(client.playlistMove(it.id, idx + 1))}>↓</button>
              <button className="ghost" aria-label="Remove" disabled={!mayRemove(it)} onClick={() => act(client.playlistRemove(it.id))}>✕</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------- Browse ---------------- */
function Row({ m, add, canControl, queued, playing }) {
  return (
    <li>
      <div className="meta">
        <strong>{m.title}</strong>
        <small>
          {m.year} · ★ {m.rating} · {m.runtime} min · {m.genres.join(', ')}
          {m.sourceUrl ? ' · streams video' : ''}
          {m.because?.length ? ` · matches ${m.because.join(', ')}` : ''}
        </small>
      </div>
      <div className="btns">
        <button className="ghost" disabled={queued} onClick={() => add(m, false)}>{playing ? 'Playing' : queued ? 'In queue' : 'Queue'}</button>
        <button className="ghost" disabled={!canControl || playing} onClick={() => add(m, true)}>Play now</button>
      </div>
    </li>
  );
}

export function Browse({ room, canControl, currentMovieId }) {
  const { client, act } = room;
  const [cats, setCats] = useState(null);
  const [q, setQ] = useState('');
  const [shelf, setShelf] = useState('');
  const [genre, setGenre] = useState('');
  const [res, setRes] = useState({ items: [], total: 0 });
  const [similar, setSimilar] = useState([]);
  const [link, setLink] = useState({ title: '', url: '' });
  const [err, setErr] = useState('');

  useEffect(() => { api.categories().then(setCats).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api.movies({ q: q.trim(), category: shelf, genre, limit: 50 }).then(setRes).catch((e) => setErr(e.message));
    }, 220);
    return () => clearTimeout(t);
  }, [q, shelf, genre]);
  useEffect(() => {
    if (!currentMovieId) return setSimilar([]);
    api.similar(currentMovieId).then((r) => setSimilar(r.items)).catch(() => setSimilar([]));
  }, [currentMovieId]);

  const { items, currentId } = client.playlist;
  const idx = items.findIndex((i) => i.id === currentId);
  const upcoming = idx < 0 ? items : items.slice(idx);
  const queuedIds = new Set(upcoming.map((i) => i.movieId).filter(Boolean));
  const add = (m, playNow) => act(client.playlistAdd({ movieId: m.id, playNow }));
  const addLink = (e) => {
    e.preventDefault();
    act(client.playlistAdd({ title: link.title.trim() || 'Untitled', url: link.url.trim() }));
    setLink({ title: '', url: '' });
  };


  return (
    <div className="pane">
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, genres, languages (typos are fine)" aria-label="Search movies" />
      <div className="chips">
        <button className={!shelf ? 'on' : ''} onClick={() => setShelf('')}>All</button>
        {cats?.shelves.map((s) => (
          <button key={s.id} className={shelf === s.id ? 'on' : ''} onClick={() => setShelf(shelf === s.id ? '' : s.id)}>{s.label}</button>
        ))}
      </div>
      <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
        <option value="">Any genre</option>
        {cats?.genres.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.count})</option>)}
      </select>

      {similar.length > 0 && !q && !shelf && !genre && (
        <>
          <h3>Because you’re watching this</h3>
          <ul className="list">{similar.slice(0, 4).map((m) => <Row key={m.id} m={m} add={add} canControl={canControl} queued={queuedIds.has(m.id)} playing={m.id === currentMovieId} />)}</ul>
        </>
      )}

      <h3>{res.total} {res.total === 1 ? 'title' : 'titles'}</h3>
      {err && <p className="error">{err}</p>}
      <ul className="list">{res.items.map((m) => <Row key={m.id} m={m} add={add} canControl={canControl} queued={queuedIds.has(m.id)} playing={m.id === currentMovieId} />)}</ul>

      <h3>Or bring your own link</h3>
      <form onSubmit={addLink} className="stack">
        <input value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Title" maxLength={200} aria-label="Title" />
        <input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://… direct .mp4 / .webm link" type="url" required aria-label="Video URL" />
        <button className="solid">Add to queue</button>
      </form>
    </div>
  );
}

/* ---------------- Polls ---------------- */
export function Polls({ room }) {
  const { client, act } = room;
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [dur, setDur] = useState(60);
  const me = client.identity.id;
  const polls = [...client.polls.values()].sort((a, b) => b.createdAt - a.createdAt);
  const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;

  const create = (e) => {
    e.preventDefault();
    act(client.pollCreate({ question: q.trim(), options: opts.map((o) => o.trim()).filter(Boolean), durationSec: Number(dur) }));
    setQ(''); setOpts(['', '']);
  };

  return (
    <div className="pane">
      <form onSubmit={create} className="stack">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the room, e.g. What next?" maxLength={200} aria-label="Question" />
        {opts.map((o, i) => (
          <input key={i} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} maxLength={100} aria-label={`Option ${i + 1}`} />
        ))}
        <div className="row">
          {opts.length < 6 && <button type="button" className="ghost" onClick={() => setOpts([...opts, ''])}>Add option</button>}
          <select value={dur} onChange={(e) => setDur(e.target.value)} aria-label="Duration">
            <option value={30}>30 sec</option><option value={60}>1 min</option><option value={180}>3 min</option><option value={0}>No limit</option>
          </select>
          <button className="solid" disabled={!valid}>Start poll</button>
        </div>
      </form>

      {polls.length === 0 && <p className="empty">No polls yet.</p>}
      {polls.map((p) => {
        const open = p.status === 'open';
        const total = p.options.reduce((s, o) => s + o.votes, 0) || 1;
        return (
          <div key={p.id} className="poll">
            <strong>{p.question}</strong>
            <small>{open ? `${p.voters} voted${p.closesAt ? ' · closes ' + new Date(p.closesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}` : 'Closed'}</small>
            {p.options.map((o, i) => (
              <button key={i} disabled={!open} onClick={() => act(client.pollVote(p.id, i))}
                className={`opt ${p.votes[me] === i ? 'mine' : ''} ${p.winners.includes(i) ? 'win' : ''}`}>
                <i style={{ width: `${(o.votes / total) * 100}%` }} />
                <span>{o.text}</span><em>{o.votes}</em>
              </button>
            ))}
            {open && (p.createdBy === me || client.isHost) && <button className="ghost" onClick={() => act(client.pollClose(p.id))}>Close poll</button>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- People ---------------- */
export function People({ room }) {
  const { client, act } = room;
  const list = [...client.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const everyone = client.settings?.controlMode === 'everyone';
  return (
    <div className="pane">
      {client.isHost && (
        <label className="switch">
          <input type="checkbox" checked={!everyone} onChange={(e) => act(client.updateSettings({ controlMode: e.target.checked ? 'host' : 'everyone' }))} />
          <span>Only the host controls playback</span>
        </label>
      )}
      <ul className="list">
        {list.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            <div className="meta">
              <strong>{p.name}{p.id === client.identity.id ? ' (you)' : ''}</strong>
              <small>{p.id === client.hostId ? 'Host' : p.connected ? 'Watching' : 'Reconnecting…'}</small>
            </div>
            {client.isHost && p.id !== client.identity.id && p.connected && (
              <button className="ghost" onClick={() => act(client.transferHost(p.id))}>Make host</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
