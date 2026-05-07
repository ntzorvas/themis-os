#!/usr/bin/env bash
# dev.sh — Εκκίνηση local development environment
# Χρήση: pnpm dev (από root) ή bash scripts/dev.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ΘΕΜΙΣ OS — Local Development"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Έλεγχος .env.local
if [ ! -f "$ROOT_DIR/.env.local" ]; then
  echo "⚠  Δεν βρέθηκε .env.local"
  echo "   Αντιγράψτε: cp .env.example .env.local"
  echo "   Και συμπληρώστε τις τιμές."
  exit 1
fi

# Έλεγχος pnpm
if ! command -v pnpm &> /dev/null; then
  echo "✗ pnpm δεν βρέθηκε. Εγκατάσταση: npm install -g pnpm"
  exit 1
fi

# Έλεγχος Node version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "✗ Node.js 22+ απαιτείται. Τρέχουσα: $(node --version)"
  echo "  Χρήση: nvm use 22"
  exit 1
fi

echo "✓ Node $(node --version)"
echo "✓ pnpm $(pnpm --version)"
echo ""
echo "Εκκίνηση υπηρεσιών..."
echo "  → API:    http://localhost:4000"
echo "  → Web:    http://localhost:3110"
echo "  → Health: http://localhost:4000/health"
echo ""

# Παράλληλη εκκίνηση API και Web (χρήση & για background)
cd "$ROOT_DIR"

# Εκκίνηση API σε background
(
  cd apps/api
  echo "[api] Εκκίνηση Fastify..."
  pnpm dev 2>&1 | sed 's/^/[api] /'
) &
API_PID=$!

# Μικρή αναμονή για να ξεκινήσει το API
sleep 2

# Εκκίνηση Web
(
  cd apps/web
  echo "[web] Εκκίνηση Next.js..."
  pnpm dev 2>&1 | sed 's/^/[web] /'
) &
WEB_PID=$!

# Cleanup σε Ctrl+C
trap "echo ''; echo 'Διακοπή...'; kill $API_PID $WEB_PID 2>/dev/null; exit 0" INT TERM

# Αναμονή για τέλος
wait $API_PID $WEB_PID
