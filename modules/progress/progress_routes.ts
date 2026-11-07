import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateStrict } from '../../middleware/auth';
import { appLocale } from '../../utils/app_locale';
import { getBodyProgress } from './body/body_service';
import { progressCached } from './progress_cache';
import { getMuscle, getProgressOverview } from './progress_service';
import { listQuery, ProgressError } from './progress_types';
import { getExercise, getExercises, getExerciseRank } from './training/exercise_service';
import { getSessions } from './training/session_service';
import { getWellnessProgress } from './wellness/wellness_service';

const router = Router();
router.use(authenticateStrict);

type Query = z.infer<typeof listQuery>;
type Action = (owner: string, query: Query, locale: string, req: Request) => Promise<unknown>;

function handle(action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listQuery.parse(req.query);
      const today = new Date(Date.now() + query.utcOffsetMinutes * 60000).toISOString().slice(0, 10);
      if (query.date > today || query.date < '2000-01-01') throw new ProgressError('Choose a current or past date');
      const owner = req.user!.userId;
      const locale = appLocale(req.headers['accept-language']);
      const key = `${req.path}:${JSON.stringify(query)}:${locale}`;
      const data = await progressCached(owner, key, () => action(owner, query, locale, req));
      res.json({ data });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.flatten() });
        return;
      }
      if (error instanceof ProgressError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

router.get('/', handle(getProgressOverview));
router.get('/exercises', handle(getExercises));
router.get('/exercises/:id/rank', handle((owner, query, _locale, req) => {
  const id = z.string().uuid().parse(req.params.id);
  return getExerciseRank(owner, id, query);
}));
router.get('/exercises/:id', handle((owner, query, locale, req) => {
  const id = z.string().uuid().parse(req.params.id);
  return getExercise(owner, id, query, locale);
}));
router.get('/muscles/:id', handle((owner, query, locale, req) => {
  return getMuscle(owner, String(req.params.id), query, locale);
}));
router.get('/sessions', handle(getSessions));
router.get('/body', handle(getBodyProgress));
router.get('/wellness', handle(getWellnessProgress));

export default router;
