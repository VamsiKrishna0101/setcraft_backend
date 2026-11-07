import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { appLocale } from '../../../utils/app_locale';
import {
  dayQuery, daySettingsSchema, itemStatusSchema, reorderSchema,
  routineSchema, setSchema, targetsSchema, completeItemSchema,
} from './session_types';
import * as service from './session_service';
import { requirePremium } from '../../subscription/subscription_service';
import prisma from '../../../config/prisma';
import { previewSchedule, applySchedule, scheduleRequest } from './schedule_service';
import { rateLimit } from '../../../middleware/rate_limit';

const router = Router();
router.use(async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'DELETE') return void next();

  // Finishing/syncing an already started workout stays available after expiry.
  const recording = req.path === '/finish' || /^\/items\/[^/]+\/(complete|sets|status)$/.test(req.path);
  if (recording && typeof req.query.date === 'string') {
    try {
      const session = await prisma.workoutSession.findUnique({
        where: { userId_date: { userId: req.user!.userId, date: req.query.date } },
      });
      if (session) return void next();
    } catch (error) { return void next(error); }
  }
  await requirePremium(req, res, next);
});
const id = z.string().uuid();
type Action = (req: Request, userId: string, date: string, offset: number) => Promise<unknown>;

function handler(action: Action, refresh: boolean | 'day' = true) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = dayQuery.parse(req.query);
      const userId = req.user!.userId;
      const data = await action(req, userId, query.date, query.utcOffsetMinutes);
      const result = refresh === 'day'
        ? await service.getTrainingDay(userId, query.date, appLocale(req.headers['accept-language']))
        : refresh
        ? await service.getTrainingWeek(userId, query.date, appLocale(req.headers['accept-language']))
        : data;
      res.json({ data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.flatten() });
        return;
      }
      if (error instanceof service.WorkoutError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

router.get('/', handler(async () => undefined));
router.post('/schedule/preview', rateLimit('schedulePreview'), handler((req, user, date) =>
  previewSchedule(user, date, scheduleRequest.parse(req.body)), false
));
router.post('/schedule/apply', rateLimit('scheduleChange'), handler((req, user, date) =>
  applySchedule(user, date, scheduleRequest.parse(req.body)), false
));
router.patch('/day', handler((req, user, date) =>
  service.updateDay(user, date, daySettingsSchema.parse(req.body))
));
router.post('/start', handler((_req, user, date, offset) =>
  service.startSession(user, date, offset)
));
router.post('/finish', handler((_req, user, date) =>
  service.finishSession(user, date), 'day'
));
router.post('/items/:id/complete', handler((req, user, date) =>
  service.completeItem(user, date, id.parse(req.params.id), completeItemSchema.parse(req.body).sets), 'day'
));
router.post('/items', handler((req, user, date) =>
  service.addSessionItem(user, date, targetsSchema.parse(req.body))
));
router.put('/order', handler((req, user, date) =>
  service.reorderItems(user, date, reorderSchema.parse(req.body).itemIds)
));
router.patch('/items/:id/status', handler((req, user, date) =>
  service.mutateItem(user, date, id.parse(req.params.id), 'status', itemStatusSchema.parse(req.body)), 'day'
));
router.patch('/items/:id/targets', handler((req, user, date) =>
  service.mutateItem(user, date, id.parse(req.params.id), 'targets', targetsSchema.omit({ workoutId: true }).partial().parse(req.body))
));
router.put('/items/:id', handler((req, user, date) =>
  service.mutateItem(user, date, id.parse(req.params.id), 'replace', targetsSchema.parse(req.body))
));
router.delete('/items/:id', handler((req, user, date) =>
  service.mutateItem(user, date, id.parse(req.params.id), 'remove', {})
));
router.put('/items/:id/sets', handler((req, user, date) =>
  service.saveSessionSet(user, date, id.parse(req.params.id), setSchema.parse(req.body)), 'day'
));
router.delete('/items/:id/sets/:number', handler((req, user, date) =>
  service.deleteSessionSet(user, date, id.parse(req.params.id), z.coerce.number().int().min(1).max(100).parse(req.params.number)), 'day'
));
router.get('/previous/:id', handler((req, user, date) =>
  service.previousPerformance(user, id.parse(req.params.id), date),
  false,
));
router.get('/routines/:id', handler((req, user) =>
  service.getRoutine(user, id.parse(req.params.id), appLocale(req.headers['accept-language'])), false
));
router.put('/routines/:id', handler((req, user) =>
  service.updateRoutine(user, id.parse(req.params.id), routineSchema.parse(req.body))
));
router.post('/routines', handler((req, user) =>
  service.saveRoutine(user, routineSchema.parse(req.body))
));
router.delete('/routines/:id', handler((req, user) =>
  service.deleteRoutine(user, id.parse(req.params.id))
));
router.post('/routines/:id/apply', handler((req, user, date) =>
  service.applyRoutine(user, date, id.parse(req.params.id))
));

export default router;
