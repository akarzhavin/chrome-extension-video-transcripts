# OAuth + Firestore setup for the Rezka extension

This document captures the one-time manual steps required before the extension can sign users in via Google and write to Firestore. Code-level setup is already done; what follows are the bits that live outside this repo (GCP Console, Firebase Console, and a packed-extension public key).

## 1. Generate a stable extension ID

`chrome.identity.getAuthToken` only works when the extension's ID is bound to a GCP OAuth client. The ID is derived from the public key inside `manifest.json`, so we need to lock that key down.

```bash
# Build the unpacked extension
cd chrome-extensions/video-transcripts/apps/rezka
EXT_ENV=dev npm run build:dev

# Load build/ as an unpacked extension in chrome://extensions
# Then in chrome://extensions click "Pack extension" — pick the build/ folder.
# Chrome writes rezka.pem next to build/.
mv ../build/rezka.pem ~/.config/lingogram/rezka.pem  # keep it OUTSIDE the repo

# Derive the base64-DER public key:
openssl rsa -in ~/.config/lingogram/rezka.pem -pubout -outform DER \
  | openssl base64 -A
```

Paste the resulting base64 string into `apps/rezka/manifest.json` at the `"key"` field (replacing `REPLACE_WITH_BASE64_DER_PUBLIC_KEY`).

After replacing `key`, reload the extension in `chrome://extensions` — the ID shown there is now deterministic and will be the same on any machine that installs this packed CRX. Copy that ID — you will need it for step 2.

## 2. Create the GCP OAuth client

1. Open GCP Console → APIs & Services → Credentials for project **`project-51896e3c-eb11-40-4279f`**.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Chrome Extension**.
4. Application ID: paste the extension ID from step 1.
5. Copy the resulting client ID (looks like `<digits>-<hash>.apps.googleusercontent.com`).
6. Paste it into `apps/rezka/manifest.json` at `oauth2.client_id` (replacing `REPLACE_WITH_GCP_OAUTH_CLIENT_ID...`).

## 3. Enable Firestore in the Firebase project

1. Firebase Console → project `project-51896e3c-eb11-40-4279f` → Firestore Database → **Create database**.
2. Mode: **Native**.
3. Location: **`eur3` (Europe)** — same as the rest of the stack.

## 4. Deploy security rules

`infrastructure/firestore.rules` is the source of truth. Deploy with:

```bash
cd /Users/aliaksandrkarzhavin/workspace/english
firebase deploy --only firestore:rules \
  --project project-51896e3c-eb11-40-4279f \
  # rules file path is read from firebase.json; if none exists in repo root,
  # supply it explicitly:
  --config infrastructure/firebase.json   # optional, see note below
```

If the repo doesn't have a top-level `firebase.json` (it currently doesn't — the only `firebase.json` lives inside the emulator submodule), point firebase-tools at the rules file directly:

```bash
cd infrastructure
firebase deploy --only firestore:rules --project project-51896e3c-eb11-40-4279f
```

…with a minimal `infrastructure/firebase.json`:

```json
{ "firestore": { "rules": "firestore.rules" } }
```

(Create that small file in `infrastructure/` if it's not there yet.)

## 5. Restart the local dev stack

`docker-compose up --build` so the Firestore emulator container picks up the new `:8080` port and the mounted rules.

Verify:
- `http://localhost:4000` — Emulator UI shows both Auth and Firestore tabs.
- `curl http://localhost:8080` returns a Firestore-emulator banner.

## 6. End-to-end check

**Dev:**
1. `EXT_ENV=dev npm run build:dev` in `apps/rezka`.
2. Reload the unpacked extension (Chrome will warn if its ID changed — re-pack if so).
3. Click the extension icon → sign in as `student@example.com` / `SecurePass123!`.
4. Open a rezka.ag tab, select a word, click the **+ Lingogram** pill.
5. Emulator UI → Firestore → `inbox/<uid>/words/<auto-id>` should appear.

**Prod:**
1. `npm run build` (default `EXT_ENV=prod`).
2. Pack to CRX with the same `.pem`, install.
3. Sign in via Google → select a word → see a 200 in DevTools (background SW network tab) to `https://firestore.googleapis.com/v1/projects/project-51896e3c-eb11-40-4279f/databases/(default)/documents/inbox/<uid>/words`.
4. Confirm document in the Firebase Console.
