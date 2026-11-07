import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getAuth } from 'firebase-admin/auth';

function firebaseApp() {
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  const defaultFile = resolve(process.cwd(), 'secrets/firebase-admin.json');
  const path = file ? resolve(file) : defaultFile;

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      let account;
      try { account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON); }
      catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON'); }
      initializeApp({ credential: cert(account), projectId: account.project_id });
    } else if (existsSync(path)) {
      const account = JSON.parse(readFileSync(path, 'utf8'));
      initializeApp({ credential: cert(account), projectId: account.project_id });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    } else {
      return null;
    }
  }

  return getApps()[0];
}

export function firebaseMessaging() {
  if (process.env.NOTIFICATIONS_DISABLED === 'true') return null;
  const app = firebaseApp();
  return app ? getMessaging(app) : null;
}

export function firebaseAuthentication() {
  const app = firebaseApp();
  return app ? getAuth(app) : null;
}
