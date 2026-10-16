import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MovieService } from '../src/movies/MovieService.js';
import { editDistance } from '../src/movies/fuzzy.js';

const movies = MovieService.fromFile();
const top = (q) => movies.query({ q }).items[0]?.title;

test('edit distance handles substitutions and transpositions', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('matrix', 'matirx'), 1);
  assert.equal(editDistance('', 'abc'), 3);
});

test('fuzzy search tolerates typos', () => {
  assert.equal(top('incepton'), 'Inception');
  assert.equal(top('interstelar'), 'Interstellar');
  assert.equal(top('matrx'), 'The Matrix');
  assert.equal(top('shinning'), 'The Shining');
  assert.equal(top('godfater'), 'The Godfather');
});

test('fuzzy search ignores case, accents and punctuation', () => {
  assert.equal(top('AMELIE'), 'Amélie');
  assert.equal(top('spiderman'), 'Spider-Man: Into the Spider-Verse');
  assert.equal(top('mad max'), 'Mad Max: Fury Road');
});

test('exact title outranks partial matches', () => {
  assert.equal(top('dune'), 'Dune');
  assert.equal(movies.query({ q: 'dune' }).items[1].title, 'Dune: Part Two');
});

test('unrelated queries return nothing', () => {
  assert.equal(movies.query({ q: 'zzzzqqqq' }).total, 0);
});

test('genre, language, year, rating and runtime filters combine', () => {
  const r = movies.query({ genres: ['Sci-Fi'], minRating: 8.5, yearFrom: 2000 });
  assert.ok(r.total > 0);
  assert.ok(r.items.every((m) => m.genres.includes('Sci-Fi') && m.rating >= 8.5 && m.year >= 2000));

  const ko = movies.query({ languages: ['ko'] });
  assert.ok(ko.items.every((m) => m.language === 'ko'));

  const short = movies.query({ maxRuntime: 15 });
  assert.ok(short.items.every((m) => m.runtime <= 15));
});

test('search composes with filters', () => {
  const r = movies.query({ q: 'dune', minRating: 8.2 });
  assert.deepEqual(r.items.map((m) => m.title), ['Dune: Part Two']);
});

test('categories list shelves, genres and languages with counts', () => {
  const c = movies.categories();
  assert.ok(c.shelves.length >= 5 && c.shelves.every((s) => s.count > 0));
  assert.ok(c.genres.find((g) => g.name === 'Drama').count > 5);
  assert.ok(c.languages.find((l) => l.code === 'ta'));
});

test('category shelf restricts and sorts results', () => {
  const r = movies.query({ category: 'classics' });
  assert.ok(r.items.every((m) => m.year < 1995));
  assert.equal(r.sort, 'rating');
  assert.throws(() => movies.query({ category: 'nope' }), { code: 'bad_category' });
});

test('pagination and sorting', () => {
  const a = movies.query({ sort: 'title', limit: 5 });
  const b = movies.query({ sort: 'title', limit: 5, offset: 5 });
  assert.equal(a.items.length, 5);
  assert.notEqual(a.items[0].id, b.items[0].id);
  assert.ok(a.total > 5);
});

test('recommendations favour shared genres and exclude seeds', () => {
  const recs = movies.recommend({ basedOn: ['inception', 'interstellar'], limit: 5 });
  assert.ok(!recs.some((m) => ['inception', 'interstellar'].includes(m.id)));
  assert.ok(recs[0].because.length > 0);
  assert.ok(recs.slice(0, 3).every((m) => m.genres.includes('Sci-Fi')));
});

test('recommendations without seeds fall back to quality and popularity', () => {
  assert.equal(movies.recommend({ limit: 3 }).length, 3);
});