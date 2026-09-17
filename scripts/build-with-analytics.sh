#!/usr/bin/env bash
#
# Build the extensions with GA4 credentials loaded from .env.
#
#   ./scripts/build-with-analytics.sh dev     # dev property,  /debug/mp/collect
#   ./scripts/build-with-analytics.sh prod    # prod property, /mp/collect
#
# Exists because the alternative is a hand-typed env prefix, and the failure
# mode of getting that wrong is silent: a build with an empty api_secret sends
# nothing at all, and a dev build carrying the prod secret pollutes the funnel
# with test traffic that cannot be separated out afterwards. Both look like a
# successful build.
#
# Credentials come from .env (gitignored). See .env.example / analytics-setup.md.

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "dev" && "$ENV_NAME" != "prod" ]]; then
    echo "usage: $0 <dev|prod>" >&2
    exit 2
fi

if [[ ! -f .env ]]; then
    echo "error: .env not found. Copy .env.example to .env and fill it in:" >&2
    echo "         cp .env.example .env" >&2
    echo "       Setup order is in docs/analytics-setup.md." >&2
    exit 1
fi

# Read .env without executing it: a credentials file should not be able to run
# commands just because a build script sourced it.
while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key// }" ]] && continue
    key="${key//[[:space:]]/}"
    value="${value%\"}"; value="${value#\"}"
    declare "ENVFILE_$key=$value"
done < .env

if [[ "$ENV_NAME" == "prod" ]]; then
    MEASUREMENT_ID="${ENVFILE_EXT_GA4_MEASUREMENT_ID_PROD:-}"
    API_SECRET="${ENVFILE_EXT_GA4_API_SECRET_PROD:-}"
    API_BASE_URL="${ENVFILE_EXT_API_BASE_URL_PROD:-}"
else
    MEASUREMENT_ID="${ENVFILE_EXT_GA4_MEASUREMENT_ID:-}"
    API_SECRET="${ENVFILE_EXT_GA4_API_SECRET:-}"
    API_BASE_URL="${ENVFILE_EXT_API_BASE_URL:-}"
fi

# A placeholder is worse than an empty value: the empty case is a documented
# silent no-op, while G-XXXXXXXXXX is a real-looking id that will never appear
# in any report, which reads as "analytics is broken" instead of "unconfigured".
if [[ -z "$MEASUREMENT_ID" || "$MEASUREMENT_ID" == "G-XXXXXXXXXX" ]]; then
    echo "error: no $ENV_NAME measurement_id in .env (still the placeholder?)" >&2
    exit 1
fi
if [[ -z "$API_SECRET" ]]; then
    echo "error: no $ENV_NAME api_secret in .env." >&2
    echo "       Admin -> Data Streams -> Measurement Protocol API secrets." >&2
    exit 1
fi

# The dictionary address, refused when empty rather than defaulted.
#
# vite.config.ts reads EXT_API_BASE_URL and falls back to '' — which builds
# CLEANLY and ships an extension with the lookup switched off: background.ts
# answers every LOOKUP_WORD with ok:false, "lookup not configured", before it
# ever fetches. The user hovers a word and gets "Couldn't load"; the build that
# produced it said nothing, because an empty value is a legitimate state and
# config.ts documents it as one.
#
# That is the point. A feature that disappears quietly is the same failure this
# script already exists to prevent for the GA4 pair — a green build, a shipped
# extension, and no signal anywhere until someone notices the gap in production.
# A release build is refused here on the same terms instead of inheriting the
# off-by-default that the library layer is right to keep.
if [[ -z "$API_BASE_URL" ]]; then
    if [[ "$ENV_NAME" == "prod" ]]; then
        echo "error: no EXT_API_BASE_URL_PROD in .env." >&2
    else
        echo "error: no EXT_API_BASE_URL in .env." >&2
    fi
    echo "       This is the dictionary gateway. Without it the build is" >&2
    echo "       silently lookup-less: see .env.example for the values, which" >&2
    echo "       mirror english/frontend/.env.lingogram-prod (VITE_API_URL)." >&2
    exit 1
fi

export EXT_GA4_MEASUREMENT_ID="$MEASUREMENT_ID"
export EXT_GA4_API_SECRET="$API_SECRET"
export EXT_API_BASE_URL="$API_BASE_URL"

# The dev-only backend switch's ring, passed through to vite.
#
# Dev only, and deliberately so: these values name every environment the build
# can reach, and a prod bundle must carry none of them. devEnvSwitch folds away
# behind __EXT_ENV__, but exporting them here for a release would also write
# each target's origin into the manifest's externally_connectable — which is
# exactly how youtube 1.0.15 shipped with preprod.lingogram.ai listed, handing
# any page on that origin the ability to ask for a signed-in user's SSO token.
#
# Absent from .env the ring is empty, the badge is inert, and the build still
# works against its own target. That is the correct outcome for a checkout
# handed no credentials, so this is NOT refused the way the GA4 pair is.
if [[ "$ENV_NAME" == "dev" ]]; then
    export EXT_DEV_TARGETS="${ENVFILE_EXT_DEV_TARGETS:-}"
    export EXT_HOME_TARGET_NAME="${ENVFILE_EXT_HOME_TARGET_NAME:-}"
    if [[ -n "$EXT_DEV_TARGETS" ]]; then
        ring=$(node -e 'const t=JSON.parse(process.env.EXT_DEV_TARGETS);console.log(t.map(x=>x.name||x.projectId).join(" -> "))' 2>/dev/null) \
            || { echo "error: EXT_DEV_TARGETS in .env is not valid JSON." >&2; exit 1; }
        echo "Backend switch ring: ${EXT_HOME_TARGET_NAME:-<own>} -> $ring -> (wraps)"
    else
        echo "No EXT_DEV_TARGETS in .env: the backend badge will be inert."
    fi
fi

# BEFORE the build: is the dev-only recorder still written in a shape that
# folds? The output gate below cannot answer this — it matches strings in a
# finished bundle, so a guard rewritten to a weaker form that leaves unnamed
# literals behind passes it while shipping readable dead code. Measured once at
# 1.6KB in a production page-script.
#
# Runs for BOTH dev and prod: a source that cannot fold is a defect either way,
# and catching it on the dev build you are about to test is cheaper than
# catching it at release time.
echo "Checking the dev-only recorder can still fold away..."
node packages/shared/assert-foldable.mjs
echo "  ok: source is foldable"
echo

echo "Building all three extensions against the $ENV_NAME property ($MEASUREMENT_ID)."
echo "Dictionary gateway: $API_BASE_URL"
if [[ "$ENV_NAME" == "dev" ]]; then
    export EXT_ENV=dev
    echo "EXT_ENV=dev -> hits go to /debug/mp/collect, which reports payload"
    echo "errors in the service-worker console instead of answering 204."
    echo "No zip is written: a dev build is loaded unpacked from build/."
fi
echo

# A dev run stops at the unpacked build/ and writes NO archive.
#
# It used to run the full `build` (zip included) with ALLOW_UNSHIPPABLE_ZIP=1,
# which produced releases/<app>-v<version>.zip — a file INDISTINGUISHABLE by
# name from a real release, sitting in the directory releases are uploaded
# from. That is how youtube 1.0.15 reached the store carrying the dev backend
# switch, a localhost origin and preprod.lingogram.ai in externally_connectable
# (any origin listed there can be handed a signed-in user's SSO token).
#
# A dev build is loaded unpacked via chrome://extensions, so the archive was
# never needed in the first place. Not writing it removes the confusable
# artifact instead of relying on someone remembering which zip is which.
BUILD_TARGET=build
if [[ "$ENV_NAME" == "dev" ]]; then
    BUILD_TARGET=build:dev
fi

for app in youtube rezka; do
    echo "--- apps/$app ---"
    npm run "$BUILD_TARGET" -w "apps/$app"
done

echo
echo "Verifying the api_secret stayed out of the page-readable bundles."
leaked=0
for app in youtube rezka; do
    for bundle in "apps/$app/build/src/content/index.js" \
                  "apps/$app/build/src/popup/popup.js" \
                  "apps/$app/build/src/content/page-script.js"; do
        [[ -f "$bundle" ]] || continue
        if grep -qF "$API_SECRET" "$bundle"; then
            echo "  LEAK: $bundle" >&2
            leaked=1
        fi
    done
    bg="apps/$app/build/src/background/background.js"
    if [[ -f "$bg" ]]; then
        if grep -qF "$API_SECRET" "$bg"; then
            echo "  ok: $app background carries the secret (expected)"
        else
            echo "  WARNING: $app background has no secret — analytics is a no-op" >&2
        fi
    fi
done

if [[ "$leaked" == "1" ]]; then
    echo >&2
    echo "The secret reached a bundle that runs in the page. That means" >&2
    echo "analytics-bg leaked through the shared barrel — do not ship this." >&2
    exit 1
fi

echo
echo "Clean: the secret is only in the background bundles."
