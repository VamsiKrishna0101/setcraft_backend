import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { notificationDevice, notificationPreferences } from './notifications_types';
import {
  getPreferences,
  savePreferences,
  registerDevice,
  removeDevice,
  sendTest,
  markNotificationOpened,
  snoozeNotification,
} from './notifications_service';

export async function preferences(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getPreferences(req.user!.userId) });
  } catch (error) {
    next(error);
  }
}

export async function updatePreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const input = notificationPreferences.parse(req.body);
    res.json({ data: await savePreferences(req.user!.userId, input) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Check your notification times and preferences.' });
      return;
    }
    next(error);
  }
}

export async function device(req: Request, res: Response, next: NextFunction) {
  try {
    const input = notificationDevice.parse(req.body);
    await registerDevice(req.user!.userId, input);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid device registration.' });
      return;
    }
    next(error);
  }
}

export async function deleteDevice(req: Request, res: Response, next: NextFunction) {
  try {
    await removeDevice(req.user!.userId, String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function test(req: Request, res: Response, next: NextFunction) {
  try {
    const input = z
      .object({ installationId: notificationDevice.shape.installationId })
      .strict()
      .parse(req.body);
    await sendTest(req.user!.userId, input.installationId);
    res.json({ success: true, message: 'Test notification queued.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Choose this device for the test.' });
      return;
    }
    next(error);
  }
}


export async function snooze(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.uuid().parse(req.params.id);
    const input = z.object({ installationId: notificationDevice.shape.installationId }).strict().parse(req.body);
    await snoozeNotification(req.user!.userId, id, input.installationId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid notification.' }); return; }
    next(error);
  }
}

export async function opened(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.uuid().parse(req.params.id);
    await markNotificationOpened(req.user!.userId, id);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid notification.' }); return; }
    next(error);
  }
}
