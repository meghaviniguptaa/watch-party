const BASE = import.meta.env.VITE_API_URL ?? '';

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Request failed (${res.status})`);
  return body;
}

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== null) p.set(k, v);
  return p.toString();
};

export const api = {
  createRoom: (body) =>
    req('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  getRoom: (code) => req(`/api/rooms/${encodeURIComponent(code)}`),
  categories: () => req('/api/movies/categories'),
  movies: (params) => req(`/api/movies?${qs(params)}`),
  similar: (id, limit = 6) => req(`/api/movies/${id}/similar?limit=${limit}`),
};

export const wsUrl = () =>
  import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// Per-tab identity so a refresh resumes the same participant (server keeps them for a grace period).
export const session = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
export const savedName = () => { try { return localStorage.getItem('wp:name') || ''; } catch { return ''; } };
export const saveName = (n) => { try { localStorage.setItem('wp:name', n); } catch { /* ignore */ } };
