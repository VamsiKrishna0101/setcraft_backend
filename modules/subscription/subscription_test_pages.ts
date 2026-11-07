import { Router } from 'express';
import { revenueCatEnabled, revenueCatSandbox } from './revenuecat';

export const subscriptionTestPages = Router();
subscriptionTestPages.get('/testing/:page', (req, res) => {
  if (!revenueCatEnabled() || !revenueCatSandbox() || !['terms', 'privacy'].includes(req.params.page)) {
    res.sendStatus(404); return;
  }
  const privacy = req.params.page === 'privacy';
  const title = privacy ? 'Test data information' : 'Test subscription information';
  const copy = privacy
    ? 'RevenueCat receives your Setcraft account identifier, test purchase history and SDK/device metadata to verify test subscriptions. Setcraft stores the resulting membership status. Use a test account when checking purchases, restore and account switching.'
    : 'This development build uses RevenueCat Test Store. Purchase amounts and subscription events are simulated. No money is charged. Choose the simulated success, failure or cancellation outcome in the test purchase dialog. Test renewals and expiry run faster than normal subscriptions.';
  res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setcraft — ${title}</title><style>body{margin:0;background:#000;color:#eee;font:16px/1.65 system-ui,sans-serif}main{max-width:640px;margin:auto;padding:48px 24px}.label{color:#aaa;font-size:12px;letter-spacing:2px}h1{font-size:30px;line-height:1.2}p{color:#bbb}</style><main><div class="label">SETCRAFT · DEVELOPMENT TESTING</div><h1>${title}</h1><p>${copy}</p><p>These pages describe the sandbox test environment. Public release requires the final Terms of Use and Privacy Policy.</p></main></html>`);
});
