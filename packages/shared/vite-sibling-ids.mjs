// The extension ids a DEV build of each edition will have, so the two can find
// each other (see packages/shared/src/sibling.ts).
//
// A store build's id comes from its signing key and is hard-coded in
// sibling.ts. An unpacked build has no key; Chrome derives its id from the
// absolute path of the folder it was loaded from: SHA-256 of the path, first
// 32 hex digits, each digit 0-f mapped to a-p. Both editions build into
// apps/<edition>/build of this checkout, so both ids are known at build time.
// Load the build from a different path (a copy, a symlink) and the ids differ:
// the two dev builds then simply do not see each other.
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps');

export function unpackedIdOf(dir) {
    const hex = createHash('sha256').update(dir).digest('hex').slice(0, 32);
    return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** { youtube, rezka } for a dev build, {} for anything shipped. */
export function siblingDevIds(isDev) {
    if (!isDev) return {};
    return {
        youtube: unpackedIdOf(resolve(APPS, 'youtube/build')),
        rezka: unpackedIdOf(resolve(APPS, 'rezka/build')),
    };
}
