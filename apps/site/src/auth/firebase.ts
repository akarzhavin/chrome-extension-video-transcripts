// Shared Firebase Web SDK init for the landing auth forms.
//
// Why the SDK (not the earlier bare-REST path): the SPA reads its session via
// the Firebase SDK (onAuthStateChanged), which persists to IndexedDB. A REST
// login writes tokens to sessionStorage, which the SDK never sees — so the SPA
// would open logged-OUT after a landing sign-in. Signing in through the SDK
// puts the session in IndexedDB, and since the SPA is served from the SAME
// origin (/app on prod; dev-serve locally), it picks the session up and the
// user lands in their dashboard already authenticated.
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  Auth,
} from 'firebase/auth';
import type { RuntimeAuthConfig, SdkOps } from './core';

// Web SDK config per environment. Values mirror
// english/frontend/.env.{preprod,lingogram-prod}; the apiKey is public (it
// identifies the project, not authorizes access). authDomain is where the OAuth
// handler runs (Firebase Authorized Domains); the emulator ignores it in dev.
function firebaseConfig(cfg: RuntimeAuthConfig) {
  if (cfg.env === 'preprod') {
    return {
      apiKey: cfg.apiKey,
      projectId: 'lingogram-preprod',
      authDomain: 'lingogram-preprod.firebaseapp.com',
      appId: '1:1079463543331:web:ed2314f0ea6e075a37e796',
    };
  }
  if (cfg.env === 'prod') {
    return {
      apiKey: cfg.apiKey,
      projectId: 'lingogram-prod',
      authDomain: 'lingogram.ai',
      appId: '1:349519555143:web:e76622b92ebb4dedef1f62',
    };
  }
  return {
    apiKey: cfg.apiKey,
    projectId: 'demo-lingogram',
    authDomain: 'localhost',
    appId: 'demo-app-id',
  };
}

let cachedAuth: Auth | null = null;

// Returns a singleton Auth. Reuses an existing app so google.ts and the
// email/password flow share one Firebase instance (and one IndexedDB session).
export function getAuthInstance(cfg: RuntimeAuthConfig): Auth {
  if (cachedAuth) return cachedAuth;
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig(cfg));
  const auth = getAuth(app);
  if (cfg.env === 'dev') {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  }
  cachedAuth = auth;
  return auth;
}

// Real SDK operations for core.ts's flows. Each signs the user in/up (the SDK
// persists the session to IndexedDB) and returns the fresh ID token for the
// backend profile call.
export function sdkOps(cfg: RuntimeAuthConfig): SdkOps {
  const auth = getAuthInstance(cfg);
  return {
    async signInEmail(email, password) {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return { idToken: await cred.user.getIdToken(), uid: cred.user.uid, email: cred.user.email };
    },
    async createEmail(email, password) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return { idToken: await cred.user.getIdToken(), uid: cred.user.uid, email: cred.user.email };
    },
    async sendReset(email) {
      await sendPasswordResetEmail(auth, email);
    },
  };
}
