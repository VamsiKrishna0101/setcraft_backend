import { Request, Response, NextFunction } from 'express';
import { exchangeSocialToken, SocialAuthError, SocialExchangeSchema } from './social_auth_service';

export async function handleSocialExchange(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  const parsed = SocialExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid sign-in request' });
    return;
  }
  try {
    res.json(await exchangeSocialToken(parsed.data.idToken));
  } catch (error) {
    if (error instanceof SocialAuthError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
}
