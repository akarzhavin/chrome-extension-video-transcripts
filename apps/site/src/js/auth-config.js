// Auth endpoint config for the landing-page login/register forms.
//
// The landing site is a static generator: this file is copied verbatim (no
// bundler, no build-time defines), so the environment is resolved at runtime
// from the hostname:
//   localhost               → local dev stack (Firebase Auth Emulator + nginx
//                             gateway from the `english` repo's `make up`)
//   preprod.lingogram.ai    → preprod project (lingogram-preprod + preprod gateway)
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
      // Emulator serves the Identity Toolkit REST surface under this prefix.
      identityToolkitUrl: 'http://localhost:9099/identitytoolkit.googleapis.com',
      apiBase: 'http://localhost:8000',
    };
  } else if (host === 'preprod.lingogram.ai') {
    config = {
      env: 'preprod',
      apiKey: 'AIzaSyBmSrf73K03PYNv1F197fNpvVZE-_E6eMI',
      identityToolkitUrl: 'https://identitytoolkit.googleapis.com',
      // Preprod edge gateway (ESPv2 Cloud Run). From .env.preprod VITE_API_URL.
      apiBase: 'https://nginx-gateway-jkpp7mbm4q-ew.a.run.app',
    };
  } else {
    config = {
      env: 'prod',
      apiKey: 'AIzaSyCHQt2zwkO-x8qm7wM5IwWAWrl_n8mlQLI',
      identityToolkitUrl: 'https://identitytoolkit.googleapis.com',
      apiBase: 'https://api.lingogram.ai',
    };
  }
  window.LINGOGRAM_AUTH = config;
})();
