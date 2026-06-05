#!/usr/bin/env bash
# Morning check — verify the live deployment is healthy before doing any work.
# Auth is the critical path (BUG-AUTH-002): we verify it explicitly.

set -uo pipefail
API="https://taproot-production-3d63.up.railway.app"

echo "Health check:"
curl -s "$API/api/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('HEALTH', d.get('status','?'), 'v'+str(d.get('version','?')), d.get('checks',{}))" 2>/dev/null \
  || echo "HEALTH FAILED (no/invalid response)"

echo "Auth check:"
curl -s -X POST "$API/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -H "X-Organization-Slug: demo-restaurant" \
  -d '{"email":"demo@taproot.pos","password":"TaprootDemo2026!"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('AUTH OK' if 'accessToken' in d else 'AUTH FAILED: ' + str(d))" 2>/dev/null \
  || echo "AUTH FAILED (no/invalid response)"

echo "Live frontend bundle → backend host:"
ASSET=$(curl -s https://taproot-pos.com/ | grep -oE '/assets/[^"]+\.js' | head -1)
if [ -n "$ASSET" ]; then
  curl -s "https://taproot-pos.com$ASSET" | grep -oE "taproot-[a-z0-9-]+\.up\.railway\.app" | sort -u \
    | sed 's/^/  bundle calls: /' || echo "  (could not read bundle)"
else
  echo "  (frontend asset not found)"
fi
