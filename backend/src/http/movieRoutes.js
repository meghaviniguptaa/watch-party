import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../util/errors.js';

const csv = (v) =>
  v === undefined
    ? []
    : [].concat(v)
        .flatMap((s) => String(s).split(','))
        .map((s) => s.trim())
        .filter(Boolean);

const num = z.coerce.number();

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(40).optional(),
  genre: z.any().optional(),
  language: z.any().optional(),
  yearFrom: num.int().optional(),
  yearTo: num.int().optional(),
  minRating: num.min(0).max(10).optional(),
  maxRuntime: num.int().positive().optional(),
  sort: z.enum(['relevance', 'rating', 'year', 'popularity', 'title']).optional(),
  limit: num.int().min(1).max(50).default(20),
  offset: num.int().min(0).default(0),
});

const RecQuery = z.object({
  basedOn: z.any().optional(),
  limit: num.int().min(1).max(30).default(10),
});

export function movieRoutes({ movies }) {
  const router = Router();

  router.get('/categories', (_req, res) => res.json(movies.categories()));

  router.get('/recommendations', (req, res) => {
    const { basedOn, limit } = RecQuery.parse(req.query);
    res.json({ items: movies.recommend({ basedOn: csv(basedOn), limit }) });
  });

  router.get('/', (req, res) => {
    const { genre, language, ...rest } = ListQuery.parse(req.query);
    res.json(movies.query({ ...rest, genres: csv(genre), languages: csv(language) }));
  });

  router.get('/:id', (req, res) => {
    const movie = movies.get(req.params.id);
    if (!movie) throw new AppError('not_found', 'Movie not found', 404);
    res.json(movie);
  });

  router.get('/:id/similar', (req, res) => {
    if (!movies.get(req.params.id)) throw new AppError('not_found', 'Movie not found', 404);
    const { limit } = RecQuery.parse(req.query);
    res.json({ items: movies.recommend({ basedOn: [req.params.id], limit }) });
  });

  return router;
}