import { readFileSync } from 'node:fs';
import { AppError } from '../util/errors.js';
import { buildIndex, scoreMatch } from './fuzzy.js';

const LANGUAGES = {
  en: 'English',
  hi: 'Hindi',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
};

const SHELVES = [
  { id: 'trending', label: 'Trending now', test: (m) => m.popularity >= 80, sort: 'popularity' },
  { id: 'top-rated', label: 'Top rated', test: (m) => m.rating >= 8.3, sort: 'rating' },
  { id: 'new-releases', label: 'New releases', test: (m) => m.year >= 2022, sort: 'year' },
  { id: 'classics', label: 'Classics', test: (m) => m.year < 1995, sort: 'rating' },
  { id: 'quick-watch', label: 'Under 100 minutes', test: (m) => m.runtime <= 100, sort: 'rating' },
  { id: 'family-night', label: 'Family night', test: (m) => m.genres.includes('Family'), sort: 'rating' },
  { id: 'world-cinema', label: 'World cinema', test: (m) => m.language !== 'en', sort: 'rating' },
];

const SORTERS = {
  relevance: (a, b) => b.score - a.score || b.movie.popularity - a.movie.popularity,
  rating: (a, b) => b.movie.rating - a.movie.rating,
  year: (a, b) => b.movie.year - a.movie.year,
  popularity: (a, b) => b.movie.popularity - a.movie.popularity,
  title: (a, b) => a.movie.title.localeCompare(b.movie.title),
};

const tally = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

export class MovieService {
  constructor(list) {
    this.list = list;
    this.byId = new Map(list.map((m) => [m.id, m]));
    this.index = new Map(
      list.map((m) => [m.id, buildIndex({ title: m.title, extra: [...m.genres, LANGUAGES[m.language] ?? ''] })]),
    );
  }

  static fromFile() {
    const raw = readFileSync(new URL('./catalog.json', import.meta.url), 'utf8');
    return new MovieService(JSON.parse(raw));
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  categories() {
    return {
      shelves: SHELVES.map(({ id, label, test }) => ({ id, label, count: this.list.filter(test).length })),
      genres: tally(this.list.flatMap((m) => m.genres)),
      languages: tally(this.list.map((m) => m.language)).map(({ name, count }) => ({
        code: name,
        name: LANGUAGES[name] ?? name,
        count,
      })),
    };
  }

  query({
    q,
    category,
    genres = [],
    languages = [],
    yearFrom,
    yearTo,
    minRating,
    maxRuntime,
    sort,
    limit = 20,
    offset = 0,
  } = {}) {
    let rows = this.list.map((movie) => ({ movie, score: 0 }));

    let shelf = null;
    if (category) {
      shelf = SHELVES.find((s) => s.id === category);
      if (!shelf) throw new AppError('bad_category', `Unknown category "${category}"`);
      rows = rows.filter((r) => shelf.test(r.movie));
    }

    const genreSet = genres.map((g) => g.toLowerCase());
    if (genreSet.length) {
      rows = rows.filter((r) => r.movie.genres.some((g) => genreSet.includes(g.toLowerCase())));
    }
    const langSet = languages.map((l) => l.toLowerCase());
    if (langSet.length) {
      rows = rows.filter(
        (r) =>
          langSet.includes(r.movie.language) || langSet.includes((LANGUAGES[r.movie.language] ?? '').toLowerCase()),
      );
    }
    if (yearFrom !== undefined) rows = rows.filter((r) => r.movie.year >= yearFrom);
    if (yearTo !== undefined) rows = rows.filter((r) => r.movie.year <= yearTo);
    if (minRating !== undefined) rows = rows.filter((r) => r.movie.rating >= minRating);
    if (maxRuntime !== undefined) rows = rows.filter((r) => r.movie.runtime <= maxRuntime);

    if (q) {
      rows = rows
        .map((r) => ({ movie: r.movie, score: scoreMatch(q, this.index.get(r.movie.id)) }))
        .filter((r) => r.score > 0);
    }

    const effectiveSort = sort ?? (q ? 'relevance' : (shelf?.sort ?? 'popularity'));
    rows.sort(SORTERS[effectiveSort]);

    return {
      total: rows.length,
      sort: effectiveSort,
      items: rows.slice(offset, offset + limit).map((r) => r.movie),
      facets: {
        genres: tally(rows.flatMap((r) => r.movie.genres)),
        languages: tally(rows.map((r) => r.movie.language)),
      },
    };
  }

  // Content-based: genre affinity to the seed titles, blended with rating and popularity.
  recommend({ basedOn = [], limit = 10 } = {}) {
    const seeds = basedOn.map((id) => this.byId.get(id)).filter(Boolean);
    const genreWeight = new Map();
    const languages = new Set();
    for (const s of seeds) {
      languages.add(s.language);
      for (const g of s.genres) genreWeight.set(g, (genreWeight.get(g) ?? 0) + 1);
    }
    const seedIds = new Set(seeds.map((s) => s.id));

    return this.list
      .filter((m) => !seedIds.has(m.id))
      .map((m) => {
        const shared = m.genres.filter((g) => genreWeight.has(g));
        const affinity = seeds.length
          ? shared.reduce((sum, g) => sum + genreWeight.get(g), 0) / (seeds.length * Math.max(m.genres.length, 1))
          : 0;
        const score =
          0.55 * affinity + 0.25 * (m.rating / 10) + 0.15 * (m.popularity / 100) + (languages.has(m.language) ? 0.05 : 0);
        return { ...m, match: Math.round(score * 100), because: shared };
      })
      .sort((a, b) => b.match - a.match || b.popularity - a.popularity)
      .slice(0, limit);
  }
}