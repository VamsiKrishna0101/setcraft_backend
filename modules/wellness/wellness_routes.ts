import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { requirePremium } from '../subscription/subscription_service';
import { wellnessDate, wellnessInput, wearableInput } from './wellness_types';
import { getWellnessEntry, saveWellnessEntry, getWearablePreference, saveWearablePreference, WellnessInputError } from './wellness_service';

const router = Router();
router.use(authenticate);
router.get('/wearable', async (req, res, next) => {
  try { res.json({ data: await getWearablePreference(req.user!.userId) }); } catch (error) { next(error); }
});
router.put('/wearable', async (req, res, next) => {
  try { res.json({ data: await saveWearablePreference(req.user!.userId, wearableInput.parse(req.body).usage) }); }
  catch (error) {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: 'Choose your wearable preference.' });
    next(error);
  }
});
router.get('/check-in/:date', async (req, res, next) => {
  try {
    const date = wellnessDate.parse(req.params.date);
    res.json({ data: await getWellnessEntry(req.user!.userId, date) });
  } catch (error) {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: 'Choose a valid date.' });
    next(error);
  }
});
router.put('/check-in/:date', requirePremium, async (req, res, next) => {
  try {
    const date = wellnessDate.parse(req.params.date);
    const { utcOffsetMinutes, ...input } = wellnessInput.parse(req.body);
    res.json({ data: await saveWellnessEntry(req.user!.userId, date, input, utcOffsetMinutes) });
  } catch (error) {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: 'Check your sleep duration and energy rating.' });
    if (error instanceof WellnessInputError) return void res.status(400).json({ error: error.message });
    next(error);
  }
});
export default router;
