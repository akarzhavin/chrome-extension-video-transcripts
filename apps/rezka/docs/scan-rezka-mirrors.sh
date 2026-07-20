#!/bin/sh
# Sweep every IANA TLD for live rezka.<tld> / hdrezka.<tld> mirrors.
#
# Output: mirror candidates (one per line) on stdout — domains that resolve to a
# real address. Stub records pointing at 127.0.0.1 (parking/defensive
# registrations) and 127.0.53.53 (ICANN name-collision wildcard zones) are
# dropped: users can never reach those.
#
# Usage:
#   docs/scan-rezka-mirrors.sh > /tmp/live.txt
# then merge with docs/mirror-domains.txt (keep retained legacy entries noted
# in its header) and regenerate the three manifest.json blocks
# (host_permissions + both content_scripts[].matches) as "*://*.<domain>/*".
#
# Notes:
# - DNS-alive != confirmed mirror: the list may include parked clones. That is
#   fine for the extension — the content script bails out unless the page has
#   the HDrezka player.
# - Content probing is unreliable from a crawler IP: real mirrors sit behind an
#   Anubis anti-bot challenge and some geo-block, so DNS is the filter we trust.
set -eu

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -s https://data.iana.org/TLD/tlds-alpha-by-domain.txt \
  | grep -v '^#' | tr 'A-Z' 'a-z' \
  | while read -r tld; do
      echo "rezka.$tld"
      echo "hdrezka.$tld"
    done > "$WORK/candidates.txt"

xargs -P 50 -I {} sh -c '
  ip=$(dig +short +time=2 +tries=1 A {} 2>/dev/null | grep -E "^[0-9]+\." | head -1)
  case "$ip" in
    ""|127.0.0.1|127.0.53.53) ;;
    *) echo "{}" ;;
  esac
' < "$WORK/candidates.txt" | sort
