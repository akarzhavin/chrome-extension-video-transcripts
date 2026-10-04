// Auth endpoint config for the landing-page login/register forms.
//
// The landing site is a static generator: this file is copied verbatim (no
// bundler, no build-time defines), so the environment is resolved at runtime
// from the hostname:
//   localhost               → local dev stack (Firebase Auth Emulator + nginx
//                             gateway from the `english` repo's `make up`)
//   preprod.lingogram.ai,
//   lingogram-preprod.web.app (and its firebaseapp.com twin)
//                           → preprod project (lingogram-preprod + preprod gateway)
//   anything else           → prod (lingogram-prod + api.lingogram.ai)
//
// The Firebase apiKey is public by design — it identifies the project, it does
// not authorize access (security is Authorized Domains + Security Rules). Values
// mirror english/frontend/.env.{preprod,lingogram-prod}.
(function () {
  'use strict';

  var host = location.hostname;
  var config;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    config = {
      env: 'dev',
      apiKey: 'demo-key',
      // Firestore project + REST host. Used by the /uninstall/ feedback form,
      // which writes the same `feedback` collection the extension's rating
      // card does. The emulator serves the REST surface on its own port.
      projectId: 'demo-lingogram',
      firestoreUrl: 'http://localhost:8080',
      // Emulator serves the Identity Toolkit REST surface under this prefix.
      identityToolkitUrl: 'http://localhost:9099/identitytoolkit.googleapis.com',
      apiBase: 'http://localhost:8000',
    };
  } else if (
    host === 'preprod.lingogram.ai' ||
    // Where preprod is actually served. Without it the forms on preprod
    // signed in against PROD Firebase while the SPA beside them used preprod.
    host === 'lingogram-preprod.web.app' ||
    host === 'lingogram-preprod.firebaseapp.com'
  ) {
    config = {
      env: 'preprod',
      apiKey: 'AIzaSyBmSrf73K03PYNv1F197fNpvVZE-_E6eMI',
      projectId: 'lingogram-preprod',
      firestoreUrl: 'https://firestore.googleapis.com',
      identityToolkitUrl: 'https://identitytoolkit.googleapis.com',
      // Preprod edge gateway, by name (feature 019 moved it off the Cloud Run
      // URL). Mirrors english/frontend/.env.preprod VITE_API_URL — keep the
      // two in step.
      apiBase: 'https://api-preprod.lingogram.ai',
    };
  } else {
    config = {
      env: 'prod',
      apiKey: 'AIzaSyCHQt2zwkO-x8qm7wM5IwWAWrl_n8mlQLI',
      projectId: 'lingogram-prod',
      firestoreUrl: 'https://firestore.googleapis.com',
      identityToolkitUrl: 'https://identitytoolkit.googleapis.com',
      apiBase: 'https://api.lingogram.ai',
    };
  }
  window.LINGOGRAM_AUTH = config;
})();
