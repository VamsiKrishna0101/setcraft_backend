import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { appLocale } from '../../utils/app_locale';
import { calendarDate } from '../progress/progress_types';
import { previewDays } from '../progress/preview/preview_data';
import { monday } from '../progress/progress_range';
import * as preview from './preview_service';

const router = Router();
router.use(authenticate);
router.get('/status', async (req, res, next) => {
  try { res.json({ data: await preview.previewStatus(req.user!.userId) }); }
  catch (error) { next(error); }
});
router.use(async (req, res, next) => {
  try {
    if (req.method !== 'GET') {
      res.status(409).json({ error: 'Preview is read-only. Switch to real data to save an entry.' });
      return;
    }
    const owner = req.user!.userId;
    if (!(await preview.previewStatus(owner)).available) {
      res.status(404).json({ error: 'No preview data for this account.' });
      return;
    }
    const offset = z.coerce.number().int().min(-840).max(840).default(0).parse(req.query.utcOffsetMinutes);
    const date = calendarDate.parse(req.query.date ?? new Date(Date.now() + offset * 60000).toISOString().slice(0, 10));
    const locale = appLocale(req.headers['accept-language']);
    const path = req.path;
    if (path === '/home') return void res.json(await preview.previewHome(owner, date, locale));
    if (path === '/heatmap/training') return void res.json(await preview.previewHeatmap(owner, date, offset, locale));
    if (path === '/body') return void res.json(await preview.previewBody(owner, date, locale));
    if (path.startsWith('/body/entries/')) {
      const body = await preview.previewBody(owner, date, locale);
      const record = body.records.find(row => row.id === path.split('/').at(-1));
      return void res.status(record ? 200 : 404).json(record ?? { error: 'Preview entry not found.' });
    }
    if (path === '/workout/training') return void res.json({ data: await preview.previewTrainingDay(owner, date, locale) });
    if (path.startsWith('/workout/training/previous/')) return void res.json({ data: { date: null, sets: [] } });
    if (path.startsWith('/nutrition/me')) {
      const parts = path.split('/');
      const mealDate = parts.length === 6
        ? calendarDate.parse(`${parts[5]}-${parts[4]!.padStart(2, '0')}-${parts[3]!.padStart(2, '0')}`) : date;
      return void res.json({ data: await preview.previewNutrition(owner, mealDate, locale) });
    }
    if (path === '/history/recovery') {
      const count = z.coerce.number().int().min(1).max(365).default(7).parse(req.query.days);
      return void res.json({ data: await preview.previewRecovery(owner, date, count) });
    }
    if (path === '/history/volume') {
      const rows = await previewDays(owner, date);
      const weeks = new Map<string, { week: string; totalVolume: number; totalSets: number }>();
      for (const row of rows) {
        const key = monday(row.date);
        const bucket = weeks.get(key) ?? { week: key, totalVolume: 0, totalSets: 0 };
        bucket.totalSets += row.data.sets.length;
        bucket.totalVolume += row.data.sets.reduce((sum, set) => sum + (set.weight ?? 0) * set.reps, 0);
        weeks.set(key, bucket);
      }
      return void res.json({ data: [...weeks.values()] });
    }
    res.status(404).json({ error: 'This action is unavailable in preview.' });
  } catch (error) {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: 'Invalid preview date or range.' });
    next(error);
  }
});
export default router;
