export const normalize = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const tokenize = (s) => {
  const n = normalize(s);
  return n ? n.split(' ') : [];
};

// Optimal string alignment distance (Levenshtein plus adjacent transpositions).
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2 = new Array(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

function tokenScore(qt, tokens) {
  let best = 0;
  for (const tt of tokens) {
    if (tt === qt) return 1;
    if (tt.startsWith(qt)) {
      best = Math.max(best, 0.9);
      continue;
    }
    if (qt.length >= 3) {
      const d = Math.min(editDistance(qt, tt), editDistance(qt, tt.slice(0, qt.length)));
      const allowed = qt.length <= 4 ? 1 : qt.length <= 8 ? 2 : 3;
      if (d <= allowed) best = Math.max(best, 0.8 - 0.15 * d);
    }
  }
  return best;
}

export function buildIndex({ title, extra = [] }) {
  const titleNorm = normalize(title);
  return {
    titleNorm,
    compact: titleNorm.replace(/ /g, ''),
    titleTokens: titleNorm ? titleNorm.split(' ') : [],
    extraTokens: tokenize(extra.join(' ')),
  };
}

// Every query term must match a title token (or a weaker extra token such as a genre).
// A compact comparison additionally handles "spiderman" vs "Spider-Man".
export function scoreMatch(query, idx) {
  const qn = normalize(query);
  if (!qn) return 0;
  const terms = qn.split(' ');

  let total = 0;
  let matched = true;
  for (const term of terms) {
    let s = tokenScore(term, idx.titleTokens);
    if (s === 0) s = 0.6 * tokenScore(term, idx.extraTokens);
    if (s === 0) {
      matched = false;
      break;
    }
    total += s;
  }
  let score = matched ? total / terms.length : 0;

  const qc = qn.replace(/ /g, '');
  if (qc.length >= 4 && score < 0.7) {
    if (idx.compact.includes(qc)) score = Math.max(score, 0.7);
    else if (
      Math.abs(idx.compact.length - qc.length) <= 3 &&
      editDistance(qc, idx.compact) <= Math.ceil(qc.length / 5)
    ) {
      score = Math.max(score, 0.55);
    }
  }

  if (score > 0) {
    if (idx.titleNorm === qn) score += 0.3;
    else if (idx.titleNorm.startsWith(qn)) score += 0.1;
  }
  return Math.min(1.3, score);
}