import { useEffect, useRef, useState } from 'react';

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(r).padStart(2, '0')}`;
};
const REACTIONS = ['🔥', '😂', '😮', '❤️', '👏', '😢'];

export default function Player({ room, item, movie, canControl }) {
  const { client, player, reactions, blocked, act } = room;
  const state = client.state;
  const [, setNow] = useState(0);
  const [scrub, setScrub] = useState(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [dur, setDur] = useState(0);
  const endedFor = useRef(null);
  const stage = useRef(null);

  const useVideo = Boolean(item?.url) && !videoFailed;
  const duration = (useVideo && dur) || (movie?.runtime ? movie.runtime * 60 : 7200);
  const pos = Math.min(player.getPosition(), duration);

  // New item: reset the fallback timeline and the failure flags.
  useEffect(() => { player.reset(); setVideoFailed(false); setDur(0); endedFor.current = null; }, [item?.id, player]);
  useEffect(() => { if (!useVideo) player.attach(null); }, [useVideo, player]);

  // Repaint the timeline, and report the end of a virtual-timeline title (video uses onEnded).
  useEffect(() => {
    const t = setInterval(() => {
      setNow((n) => n + 1);
      if (!useVideo && item && client.state?.playing && player.getPosition() >= duration && endedFor.current !== item.id) {
        endedFor.current = item.id;
        act(client.ended(item.id));
      }
    }, 250);
    return () => clearInterval(t);
  }, [useVideo, item, duration, client, player, act]);

  const toggle = () => act(state.playing ? client.pause() : client.play());
  const commitScrub = () => { if (scrub !== null) { act(client.seek(scrub)); setScrub(null); } };
  const shown = scrub ?? pos;

  return (
    <section className="player">
      <div className="stage" ref={stage}>
        {useVideo ? (
          <video
            key={item.id}
            ref={(el) => player.attach(el)}
            src={item.url}
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
            onEnded={() => { endedFor.current = item.id; act(client.ended(item.id)); }}
            onError={() => setVideoFailed(true)}
          />
        ) : (
          <div className="slate">
            {item ? (
              <>
                <h2>{item.title}</h2>
                <p>
                  {movie ? `${movie.year} · ${movie.genres.join(', ')}` : 'Custom link'}
                  {videoFailed ? ' — the video couldn’t be loaded here, so the room is running on a shared timer' : ' — no video file attached, running on a shared timer'}
                </p>
              </>
            ) : (
              <>
                <h2>Nothing queued yet</h2>
                <p>Pick something from Browse and the room starts together.</p>
              </>
            )}
          </div>
        )}
        {blocked && useVideo && (
          <button className="unmute" onClick={() => player.play()}>Tap to join playback</button>
        )}
        <div className="floaters" aria-hidden="true">
          {reactions.map((r) => (
            <span key={r.id} style={{ left: `${r.x}%` }} title={r.name}>{r.emoji}</span>
          ))}
        </div>
        <button className="fs" aria-label="Fullscreen" onClick={() => stage.current?.requestFullscreen?.()}>⛶</button>
      </div>

      <div className="controls">
        <button className="round" disabled={!item || !canControl} onClick={toggle} aria-label={state?.playing ? 'Pause' : 'Play'}>
          {state?.playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{fmt(shown)}</span>
        <input
          type="range" min="0" max={duration} step="1" value={shown} disabled={!item || !canControl}
          aria-label="Seek"
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commitScrub} onKeyUp={commitScrub}
        />
        <span className="time">{fmt(duration)}</span>
        <button className="ghost" disabled={!item || !canControl} onClick={() => act(client.playlistNext())}>Next</button>
      </div>
      {!canControl && <p className="hint">Host-only controls are on. Ask the host to press play.</p>}

      <div className="reactbar">
        {REACTIONS.map((e) => (
          <button key={e} onClick={() => act(client.react(e))} aria-label={`React ${e}`}>{e}</button>
        ))}
      </div>
    </section>
  );
}
