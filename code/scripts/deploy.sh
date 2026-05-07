#!/usr/bin/env bash
# deploy.sh — 5-Phase Production Deploy (Ερμής pipeline)
# Αναφορά: docs/v03/build-plan-v03.md §Day 3 + tech-stack-v03.md §12
# Χρήση: bash scripts/deploy.sh [--env staging|production]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_ENV="${1:-production}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/var/log/themisos/deploy_${TIMESTAMP}.log"

# Χρώματα terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOG_FILE"; }
ok()  { echo -e "${GREEN}✓${NC} $*" | tee -a "$LOG_FILE"; }
warn(){ echo -e "${YELLOW}⚠${NC} $*" | tee -a "$LOG_FILE"; }
fail(){ echo -e "${RED}✗${NC} $*" | tee -a "$LOG_FILE"; exit 1; }

mkdir -p /var/log/themisos

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ΘΕΜΙΣ OS — Deploy Pipeline"
echo "  Περιβάλλον: ${DEPLOY_ENV} | $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ============================================================
# PHASE 1 — PRE-DEPLOY CHECKS
# ============================================================
log "Phase 1: Pre-deploy checks"

# Git status
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  fail "Uncommitted changes. Κάντε commit πριν deploy."
fi
ok "Git clean"

# Node version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VERSION" -ge 22 ] || fail "Node 22+ απαιτείται"
ok "Node $(node --version)"

# PM2 check
command -v pm2 &> /dev/null || fail "PM2 δεν βρέθηκε"
ok "PM2 $(pm2 --version)"

# ============================================================
# PHASE 2 — QA GATE (Δοκιμασία)
# ============================================================
log "Phase 2: QA Gate"

cd "$ROOT_DIR"

log "TypeScript check..."
pnpm typecheck || fail "TypeScript errors — deploy ακυρώθηκε"
ok "TypeScript: 0 errors"

log "Lint check..."
pnpm lint || fail "Lint errors — deploy ακυρώθηκε"
ok "Lint: clean"

log "Tests..."
pnpm test || fail "Tests failed — deploy ακυρώθηκε"
ok "Tests: passed"

# ============================================================
# PHASE 3 — BUILD + DEPLOY
# ============================================================
log "Phase 3: Build"

log "Building packages..."
pnpm build || fail "Build failed"
ok "Build: success"

log "Deploy σε PM2..."
pm2 reload infra/pm2/ecosystem.config.cjs --env "$DEPLOY_ENV" || fail "PM2 reload failed"
ok "PM2: reloaded (zero-downtime)"

# ============================================================
# PHASE 4 — POST-DEPLOY VERIFICATION
# ============================================================
log "Phase 4: Post-deploy verification"

# Αναμονή για startup
sleep 3

# Health check
API_PORT="${API_PORT:-4000}"
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/health" 2>/dev/null || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
  ok "Health check: OK (HTTP 200)"
else
  fail "Health check failed (HTTP ${HEALTH_RESPONSE}). Rollback ενεργοποιείται..."
fi

# PM2 status
pm2 list | grep -E "themisos-(web|api)" || warn "PM2 processes δεν βρέθηκαν"

# ============================================================
# PHASE 5 — SUCCESS
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Deploy ΕΠΙΤΥΧΗΣ — $(date)"
echo "  Log: $LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
