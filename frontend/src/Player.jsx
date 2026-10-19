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
  const duration = useVideo ? dur || 0 : movie?.runtime ? movie.runtime * 60 : 0;
  const pos = duration ? Math.min(player.getPosition(), duration) : player.getPosition();

  // New item: reset the fallback timeline and the failure flags.
  useEffect(() => { player.reset(); setVideoFailed(false); setDur(0); endedFor.current = null; }, [item?.id, player]);
  useEffect(() => { if (!useVideo) player.attach(null); }, [useVideo, player]);

  // Repaint the timeline, and report the end of a virtual-timeline title (video uses onEnded).
  useEffect(() => {
    const t = setInterval(() => {
      setNow((n) => n + 1);
      if (!useVideo && item && duration>0 && client.state?.playing && player.getPosition() >= duration && endedFor.current !== item.id) {
        endedFor.current = item.id;
        act(client.ended(item.id));
      }
    }, 250);
    return () => clearInterval(t);
  }, [useVideo, item, duration, client, player, act]);

    const can = Boolean(item) && canControl;
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const showFlash = (txt) => {
    setFlash({ txt, k: Date.now() });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 600);
  };
  const toggle = () => {
    if (!can) return; // host-only rooms: everyone else's clicks and keys do nothing
    showFlash(state?.playing ? '❚❚' : '▶');
    act(state?.playing ? client.pause() : client.play());
  };
  const skip = (delta) => {
    if (!can || (delta > 0 && !duration)) return;
    const p = player.getPosition() + delta;
    showFlash(delta < 0 ? '↺ 10s' : '10s ↻');
    act(client.seek(delta < 0 ? Math.max(0, p) : Math.min(p, duration)));
  };

  // Space toggles play/pause from anywhere on the page, except while typing.
  const live = useRef(toggle);
  live.current = toggle;
  useEffect(() => {
    let mouse = false;
    const down = () => { mouse = true; };
    const onKey = (e) => {
      const wasMouse = mouse; mouse = false;
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.closest?.('input:not([type=range]), textarea, select, [contenteditable]')) return;
      if (t.closest?.('button, a, [role=tab]')) {
        if (!wasMouse) return; // keyboard user on a focused button: let Space press that button
        t.blur(); // they clicked it with the mouse; Space should mean play/pause, not "click it again"
      }
      e.preventDefault();
      live.current();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', onKey); };
  }, []);
  const commitScrub = () => { if (scrub !== null) { act(client.seek(scrub)); setScrub(null); } };
  const shown = scrub ?? pos;

  return (
    <section className="player">
      <div className={`stage ${can ? 'clickable' : ''}`} ref={stage} onClick={toggle}>
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
          <button className="unmute" onClick={(e) => { e.stopPropagation(); player.play(); }}>Tap to join playback</button>
        )}
        <div className="floaters" aria-hidden="true">
          {reactions.map((r) => (
            <span key={r.id} style={{ left: `${r.x}%` }} title={r.name}>{r.emoji}</span>
          ))}
        </div>
               {can && (
          <div className="hover-ctl">
            <button aria-label="Back 10 seconds" onClick={(e) => { e.stopPropagation(); skip(-10); }}>↺ 10</button>
            <button className="big" aria-label={state?.playing ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); toggle(); }}>
              {state?.playing ? '❚❚' : '▶'}
            </button>
            <button aria-label="Forward 10 seconds" disabled={!duration} onClick={(e) => { e.stopPropagation(); skip(10); }}>10 ↻</button>
          </div>
        )}
        {flash && <div key={flash.k} className="flash">{flash.txt}</div>}
        <button className="fs" aria-label="Fullscreen" onClick={(e) => { e.stopPropagation(); stage.current?.requestFullscreen?.(); }}>⛶</button>
      </div>

      <div className="controls">
        <button className="round" disabled={!item || !canControl} onClick={toggle} aria-label={state?.playing ? 'Pause' : 'Play'}>
          {state?.playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{fmt(shown)}</span>
        <input
          type="range" min="0" max={duration || 1} step="1" value={Math.min(shown, duration || 1)} disabled={!item || !canControl || !duration}
          aria-label="Seek"
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commitScrub} onKeyUp={commitScrub}
        />
        <span className="time">{duration ? fmt(duration) : '--:--'}</span>
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
