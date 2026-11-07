import { Request, Response } from "express";
import { getHomeData } from "./home_service";
import { appLocale } from '../../utils/app_locale';
import { localizedHomeData } from './home_locale';
import { calendarDate } from '../progress/progress_types';

export async function getHome(req: Request, res: Response) {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        const forceRefresh = req.query.refresh === "true" || req.headers["cache-control"] === "no-cache";
        const date = req.query.date === undefined ? undefined : calendarDate.safeParse(req.query.date);
        if (date && !date.success) return void res.status(400).json({ error: 'Invalid calendar date.' });
        const data = await getHomeData(userId, forceRefresh, date?.data);
        const locale = appLocale(req.headers['accept-language']);
        res.json(await localizedHomeData(data,locale,userId));
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}
