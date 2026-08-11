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
else
    MEASUREMENT_ID="${ENVFILE_EXT_GA4_MEASUREMENT_ID:-}"
    API_SECRET="${ENVFILE_EXT_GA4_API_SECRET:-}"
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

export EXT_GA4_MEASUREMENT_ID="$MEASUREMENT_ID"
export EXT_GA4_API_SECRET="$API_SECRET"

echo "Building all three extensions against the $ENV_NAME property ($MEASUREMENT_ID)."
if [[ "$ENV_NAME" == "dev" ]]; then
    export EXT_ENV=dev
    # assert-shippable refuses to zip a dev build — it carries localhost origins
    # and the dev backend switch, and a zip is one upload away from the store.
    # We want the unpacked build/ directory, so allow the zip step through
    # rather than losing the whole build to a guard aimed at releases.
    export ALLOW_UNSHIPPABLE_ZIP=1
    echo "EXT_ENV=dev -> hits go to /debug/mp/collect, which reports payload"
    echo "errors in the service-worker console instead of answering 204."
    echo "ALLOW_UNSHIPPABLE_ZIP=1 -> the release guard would otherwise stop the"
    echo "build at the zip step. Do NOT upload a zip produced by this run."
fi
echo

for app in youtube rezka web; do
    echo "--- apps/$app ---"
    npm run build -w "apps/$app"
done

echo
echo "Verifying the api_secret stayed out of the page-readable bundles."
leaked=0
for app in youtube rezka web; do
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
