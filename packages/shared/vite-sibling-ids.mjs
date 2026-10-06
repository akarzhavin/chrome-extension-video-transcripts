// The fixed identity of each edition's DEV build, so the two can find each
// other (see packages/shared/src/sibling.ts) wherever they are loaded from.
//
// A store build's id comes from the store's signing key and is hard-coded in
// sibling.ts. An unpacked build without a `key` gets an id derived from the
// absolute path of its folder, so a second checkout, a worktree or a moved
// folder each produced a new id the sibling did not know. With `key` in the
// manifest Chrome derives the id from the key instead: the same id from any
// folder, across any number of reinstalls.
//
// Public keys only. An unpacked extension needs no private key, and none was
// kept: these keys cannot sign a package, so they grant nothing.
//
// DEV ONLY. A release build must carry no `key` at all — the store holds the
// real one, and a package with a different key is refused on upload. The vite
// configs add it only when isDev, and two gates refuse it in a release:
// assert-source-manifests.mjs before the build, assert-shippable.mjs after it.
import { createHash } from 'node:crypto';

/** SPKI DER, base64 — what manifest.json's `key` holds. */
export const DEV_KEYS = {
    youtube: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs9FOlWS+xFpeCt2wXYiD4rYuxuDN0+tks44UYC5eYzS02tg3WlPTRoGEFGA67dHrpE9vqIHx08dOt8PxsCBGytpOgoVtNCBvKYWeVDBm+zE7egZADwBGhrapUV7qI5S6nSuYnSrV9E/RSNjOtrkI4l3S4HlFu21FsiKZQvBlXRbr8wKGZzIlb9iLUaKD5r96k6OZfWwwmeMBBgDWv1JYUKstY1kLRSSDdN9c87Bpx4bcdwETDF9LBeJNVOgTp2p0Lzg9c8GtoSb55cm7dx6yT8dE7zcTvY5LTFHzVMCDpzY1+jZnoUXJ4FSbgnIEEcoDVj4Ulm5eTG1hP3tuQ1cVmwIDAQAB',
    rezka: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr//BUCXbbD5OqRV9fJAW0YG4NxBQH1PVgYpFbXLb1gjD3MupjktND6qSxDp3EH5Y+KN/mg6ScjuraMpqpnbCN7PzwyGR+Tga4xrYvzAdiUpANKXsdFhX+PONzeWY+1O/xCvo3gZGEJXJZBN4jODJmrgXEOkB76pKWtpXFxXDez2sR4vK5fz+dxke5fAeL+neahajG/2zl23Z4YTkIfe0TGm/Yf+/6qWVqylnVUxKMXdPdCMTX4FBafqdCSynk39avcbsnZW+qcC0/PkcD/RWlY4PQTp2Jt08wOzrCm1rOvyvw5C5m2zjNHQEBHISwzK2InR6l+oRz0qa2621P0YOWQIDAQAB',
};

/** Chrome's id for a key: SHA-256 of the DER, first 32 hex digits, 0-f mapped to a-p. */
export function idOfKey(base64Der) {
    const hex = createHash('sha256').update(Buffer.from(base64Der, 'base64')).digest('hex').slice(0, 32);
    return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** { youtube, rezka } for a dev build, {} for anything shipped. */
export function siblingDevIds(isDev) {
    if (!isDev) return {};
    return { youtube: idOfKey(DEV_KEYS.youtube), rezka: idOfKey(DEV_KEYS.rezka) };
}
