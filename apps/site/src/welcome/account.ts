// Sign-up / sign-in for the welcome page's Account step, and the extension
// token that follows it.
//
// Loaded on demand by steps.ts (a separate chunk: the Firebase SDK is only
// fetched when someone opens the Account step). The account itself is made
// exactly as on /register/ and /login/ — the same core.ts flows over the
// Firebase Web SDK, so the session lands in IndexedDB and the SPA on this
// origin opens signed in. The extension then gets its own scoped token from
// /auth/extension-token, the same endpoint the /extension-auth page uses.

import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { fetchWithRetry, loginUser, registerUser, toAuthError, AuthError, type RuntimeAuthConfig } from '../auth/core';
import { getAuthInstance, sdkOps } from '../auth/firebase';

export interface SignedIn {
  uid: string;
  email: string;
  idToken: string;
}

export interface AccountDeps {
  register(email: string, password: string): Promise<SignedIn>;
  login(email: string, password: string): Promise<SignedIn>;
  google(): Promise<SignedIn>;
  /** A custom token the extension can exchange for its own session. */
  extensionToken(idToken: string): Promise<string>;
  /** The site's own session from an earlier visit, if there is one. */
  session?(): Promise<SignedIn | null>;
}

export function realDeps(cfg: RuntimeAuthConfig): AccountDeps {
  const auth = getAuthInstance(cfg);
  const current = async (): Promise<SignedIn> => {
    const u = auth.currentUser;
    if (!u) throw new AuthError('Sign-in did not complete. Please try again.', 'welcome/no-user');
    return { uid: u.uid, email: u.email ?? '', idToken: await u.getIdToken() };
  };
  return {
    async register(email, password) {
      await registerUser(sdkOps(cfg), cfg, { email, password });
      return current();
    },
    async login(email, password) {
      await loginUser(sdkOps(cfg), cfg, { email, password });
      return current();
    },
    async google() {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (err) {
        throw toAuthError(err);
      }
      const me = await current();
      // First Google sign-in: /auth/me creates the app profile, as on /login/.
      const res = await fetchWithRetry(cfg.apiBase + '/auth/me', { headers: { Authorization: 'Bearer ' + me.idToken } });
      if (!res.ok) throw new AuthError('Could not reach your account (' + res.status + ').', 'backend/' + res.status);
      return me;
    },
    async session() {
      // The SDK restores a stored session asynchronously; currentUser is null
      // until it has.
      await auth.authStateReady();
      return auth.currentUser ? current() : null;
    },
    async extensionToken(idToken) {
      const res = await fetchWithRetry(cfg.apiBase + '/auth/extension-token', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken },
      });
      if (!res.ok) throw new AuthError('Could not connect the extension (' + res.status + ').', 'backend/' + res.status);
      const body = (await res.json()) as { customToken?: string };
      if (!body.customToken) throw new AuthError('Could not connect the extension.', 'backend/no-token');
      return body.customToken;
    },
  };
}
