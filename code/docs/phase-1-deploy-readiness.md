# ΘΕΜΙΣ OS — Phase 1 Deploy Readiness Assessment

**Αξιολογητής**: Ερμης (Master Deployer)
**Ημερομηνία**: 2026-04-29
**Mode**: READINESS CHECK ONLY — κανένα πραγματικό deploy
**Target**: Preview Server 89.167.110.132

---

## EXECUTIVE VERDICT

**STATUS: CONDITIONAL — ΟΧΙ ΕΤΟΙΜΟ ΓΙΑ DEPLOY ΣΗΜΕΡΑ**

Το codebase είναι σε καλή κατάσταση μετά το Day 10b sprint. Ωστόσο,
3 εξωτερικές υποδομές (Vault, Redis, R2) απουσιάζουν εντελώς από το
Preview environment. Χωρίς αυτά, το API δεν μπορεί να ξεκινήσει, η
φόρτωση εγγράφων αποτυγχάνει, και τα BullMQ workers δεν λειτουργούν.
Μόλις ο Niko παρέχει τα credentials και γίνουν 2 ακόμα ενέργειες
(βλ. Action Items), το deploy μπορεί να προχωρήσει σε ~2-3 ώρες.

---

## GATE-BY-GATE ΑΝΑΛΥΣΗ

### Gate 1: Build Readiness — CONDITIONAL

| Στόχος | Αποτέλεσμα | Σημείωση |
|--------|-----------|---------|
| `pnpm --filter @themisos/api typecheck` exit 0 | PASS | Day 10b confirmed exit 0 |
| `pnpm --filter @themisos/web typecheck` exit 0 | PASS | Day 10b confirmed exit 0 |
| `packages/greek-utils/dist/` exists | PASS | Fix P1-2 applied — afm.js, index.js, normalize.js present |
| `pnpm --filter @themisos/api build` (tsc compile) | LIKELY PASS | Χρησιμοποιεί tsconfig.build.json με exclude tests. Δεν ζητά runtime credentials. Αναμένεται exit 0. |
| `pnpm --filter @themisos/web build` (Next.js production) | BLOCKED | Next.js build απαιτεί valid env vars. VAULT_ADDR/NEXTAUTH_SECRET/R2 vars κενές → Next.js θα αποτύχει αν τα χρησιμοποιεί σε build-time. Χρειάζεται `.env.preview` με dummy-safe τιμές. |
| `dist/worker.js` (BullMQ worker entry) | MISSING | Δεν υπάρχει `src/worker.ts` — μόνο `src/queues/document-processing.ts`. Worker entry point δεν έχει υλοποιηθεί. PM2 config το έχει με `autorestart: false` ως workaround. |

**Ευρήματα:**
- API build: Καθαρός TypeScript compile, δεν εξαρτάται από runtime services κατά build.
- Web build: Κίνδυνος αποτυχίας αν το Next.js προσπαθεί να επαληθεύσει env vars κατά build time (NEXTAUTH_SECRET, NEXTAUTH_URL). Χρειάζεται `.env.preview` file πριν `next build`.
- Worker: `dist/worker.js` δεν θα παραχθεί γιατί δεν υπάρχει `src/worker.ts`. Το PM2 ecosystem έχει `autorestart: false` για αυτόν τον λόγο — αποδεκτό για Preview.

---

### Gate 2: Infrastructure Dependencies — BLOCKED

| Service | Απαιτείται για | Status Preview |
|---------|---------------|---------------|
| **PostgreSQL 16+** | DB migrations, tenant provisioning | ΠΑΡΕΧΕΤΑΙ: Preview server (89.167.110.132) έχει Postgres. Χρειάζεται νέα DB `themisos_preview`. |
| **Redis 7** (BullMQ) | Document processing queue, OCR, email queue | ΑΓΝΩΣΤΟ: Δεν είναι γνωστό αν υπάρχει Redis στο Preview. Πιθανώς όχι — χρειάζεται provision. |
| **HashiCorp Vault** | Envelope encryption κάθε document upload | ΑΠΟΥΣΙΑΖΕΙ: Δεν έχει provisioned πουθενά. Η φόρτωση εγγράφων αποτυγχάνει χωρίς Vault. Dev mode (in-memory) είναι εναλλακτική για Preview. |
| **Cloudflare R2 EU** | Document storage (upload/download) | ΑΠΟΥΣΙΑΖΕΙ: R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY κενά. Niko-pending. |
| **Resend** | Transactional emails (register, reset password) | ΑΠΟΥΣΙΑΖΕΙ: RESEND_API_KEY κενό. Niko-pending. Μη-αποκλειστικό για Preview (stubbed). |
| **Qdrant PC** (10.0.0.10) | AI advisor, legal search (Phase 2) | ΥΠΑΡΧΕΙ: Qdrant στο PC μέσω WireGuard. Δεν απαιτείται για Phase 1 Preview. |

**Κρίσιμα BLOCKED:**
- Vault: Χωρίς αυτό, κάθε document upload επιστρέφει ENCRYPTION_ERROR. Λύση για Preview: `vault server -dev` (in-memory mode) — χωρίς HA, αποδεκτό για staging.
- Redis: BullMQ workers δεν ξεκινούν χωρίς Redis URL. Η REST API λειτουργεί, αλλά document OCR και email queue παύουν. Λύση: `docker run redis:7-alpine` στο Preview server.
- R2: Document upload fails. Για Preview μπορεί να χρησιμοποιηθεί Cloudflare R2 dev bucket (χωριστό από production).

---

### Gate 3: Configuration — CONDITIONAL

| Κριτήριο | Status |
|---------|--------|
| `.env.example` υπάρχει | PASS — Πλήρες, 155 γραμμές, καλά δομημένο |
| Multi-environment config pattern | PARTIAL — Υπάρχει `.env.example` μόνο. Λείπουν `.env.preview`, `.env.staging`. |
| Secrets management strategy | PARTIAL — Vault για KMS (σωστά), αλλά non-KMS secrets (DB passwords, R2 keys) δεν έχουν καθορισμένη στρατηγική για Preview. |
| Required vars documented | PASS — Όλες οι required vars υπάρχουν στο `.env.example` με σχόλια. |
| `.env.preview` file | MISSING — Πρέπει να δημιουργηθεί από τον Niko πριν deploy. |
| NEXTAUTH_SECRET | MISSING — Κρίσιμο για Next.js build. |
| JWT_REFRESH_TTL_DAYS vs P2-1 | ATTENTION — `/api/v1/auth/refresh` δεν έχει handler. Το env var ορίζεται αλλά δεν χρησιμοποιείται. Decision needed (βλ. known issues P2-1). |

**Required vars για Preview (minimum viable):**

```
DATABASE_URL=postgres://app_user:PASS@localhost:5432/themisos_preview
NODE_ENV=staging
VAULT_ADDR=http://127.0.0.1:8200
VAULT_TOKEN=<dev-root-token>
VAULT_NAMESPACE=themisos
VAULT_KV_MOUNT=kv
R2_ACCOUNT_ID=<niko>
R2_ACCESS_KEY_ID=<niko>
R2_SECRET_ACCESS_KEY=<niko>
R2_BUCKET=themisos-documents-preview
REDIS_URL=redis://localhost:6379
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://preview.themisos.mece.gr
JWT_ACCESS_TTL=3600
API_PORT=4000
WEB_PORT=3110
PRODUCT_DOMAIN=preview.themisos.mece.gr
RESEND_API_KEY=<niko — optional για Preview>
EMAIL_FROM=noreply@themisos.gr
```

---

### Gate 4: Deployment Target — CONDITIONAL

| Στόχος | Status |
|--------|--------|
| Preview server (89.167.110.132) accessible | ASSUMED OK — Hetzner CX33, υπάρχει ήδη |
| Traefik (reverse proxy) | EXISTS — Υπάρχει στο Preview server |
| Domain για Preview | MISSING — themisos.gr/themis.legal δεν έχουν αγοραστεί ακόμα |
| Preview subdomain (*.preview.mece.gr) | RECOMMENDED — Χρήση `preview.themisos.mece.gr` μέχρι να αγοραστεί domain |
| SSL (Let's Encrypt via Traefik) | CONDITIONAL — Δουλεύει αν domain ορίσει το A record σωστά |
| PM2 ecosystem file | EXISTS — `infra/pm2/ecosystem.config.cjs` έτοιμο |
| nginx config template | EXISTS — `infra/nginx/themisos.conf.template` έτοιμο, χρειάζεται `envsubst` |

**Σημείωση για Traefik vs nginx:** Το infra template χρησιμοποιεί nginx, αλλά το Preview server έχει Traefik. Επιλογές:
- Α (συνιστάται για Preview): Χρήση Traefik labels στο PM2 — ή απλά expose ports 4000/3110 μέσω Traefik routing rules.
- Β: Παράλληλη nginx εγκατάσταση στο Preview — πιο πολύπλοκο, δεν αξίζει για Preview.

**Προτεινόμενο domain για Preview**: `preview.themisos.mece.gr`
- DNS A record → 89.167.110.132 (μέσω Cloudflare)
- SSL: Traefik + Let's Encrypt (αυτόματο)

---

### Gate 5: Runtime Checks — CONDITIONAL

| Στόχος | Status |
|--------|--------|
| Health endpoint `/health` | EXISTS — `GET /health` επιστρέφει `{status:"ok", service, version, ts}` |
| DB migrations apply σε empty Postgres | CONDITIONAL — Scripts (0000-0007) υπάρχουν. Λείπει `scripts/migrate.sh` (P4-3). Χειροκίνητη εκτέλεση ΜΕ τη σωστή σειρά απαιτείται. |
| Migration ordering documented | PARTIAL — P4-3 open issue. Σειρά: 0000 → 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007. |
| BullMQ workers start command | MISSING — `dist/worker.js` δεν υπάρχει. PM2 `autorestart: false` workaround. Workers δεν θα τρέχουν στο Preview. |
| Document processing queue | NON-FUNCTIONAL χωρίς worker. OCR = silent no-op. |
| Tenant provisioning (synchronous DDL) | WORKS — αλλά slow (P3-16 known). Αποδεκτό για Preview. |
| API port | 4000 (confirmed) |
| Web port | 3110 (confirmed) |
| `pnpm build:packages` before app build | REQUIRED — Πρέπει να τρέξει πριν `pnpm build` για να υπάρχει `packages/greek-utils/dist/` |

---

### Gate 6: Rollback Strategy — CONDITIONAL

| Στόχος | Status |
|--------|--------|
| Atomic deploy pattern | PARTIAL — PM2 ecosystem file υπάρχει, αλλά δεν υπάρχει `hub-deploy.sh`-style script με archive/rollback. |
| DB migration rollback | MISSING — Δεν υπάρχουν `down` migrations. Rollback = pg_restore από manual backup. |
| Zero-downtime deploys | NOT YET — PM2 `reload` (zero-downtime) δουλεύει μόνο αν app είναι ήδη running. Πρώτο deploy = downtime ~30s. |
| Build archives | NOT YET — Δεν υπάρχει `/opt/themisos-builds/` pattern ακόμα. |

**Rollback για Preview** (αποδεκτό επίπεδο): Git-based rollback είναι αρκετό. Αν κάτι πάει στραβά, `git checkout <previous-commit>`, rebuild, PM2 reload.

---

## NIKO ACTION ITEMS (ranked)

### Blocking — χωρίς αυτά δεν γίνεται deploy

| # | Ενέργεια | ETA | Σημείωση |
|---|---------|-----|---------|
| 1 | Παρέχε R2 EU credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) + δημιούργησε bucket `themisos-documents-preview` | 15 min | Χωρίς αυτό: document upload = 500 |
| 2 | Αποφάσισε για Vault σε Preview: (α) `vault server -dev` στο Preview server [συνιστάται — απλό, in-memory] ή (β) dedicated Vault CX22 [production-grade αλλά ~2h setup] | 10 min απόφαση | Document encryption μη-λειτουργικό χωρίς Vault |
| 3 | DNS: Πρόσθεσε A record `preview.themisos.mece.gr` → 89.167.110.132 στο Cloudflare | 5 min | Χρειάζεται domain + SSL |

### Important — πριν πρώτο pilot demo

| # | Ενέργεια | ETA |
|---|---------|-----|
| 4 | Παρέχε RESEND_API_KEY (transactional emails). Χωρίς αυτό: register/forgot-password emails δεν στέλνονται — stub υπάρχει, αποδεκτό για Preview. | Όποτε |
| 5 | Αγορά domain: themisos.gr ή themis.legal (ήδη Niko-pending) | Πριν production |
| 6 | Απόφαση για `/api/v1/auth/refresh`: (α) Hard 8h sessions [απλό, αφήνουμε ως έχει] ή (β) Implement sliding refresh [2.5h dev work] | Πριν pilot |

### Δεν απαιτείται Niko

| # | Ενέργεια | Owner |
|---|---------|-------|
| 7 | Redis: `docker run -d --name themisos-redis -p 6379:6379 redis:7-alpine` στο Preview server | Ερμης κατά deploy |
| 8 | Vault dev mode: `vault server -dev -dev-root-token-id=preview-root-token &` | Ερμης κατά deploy |
| 9 | Δημιουργία `.env.preview` από `.env.example` με Preview-specific τιμές | Ερμης κατά deploy |
| 10 | Traefik routing rule για `preview.themisos.mece.gr` → ports 3110/4000 | Ερμης κατά deploy |

---

## RECOMMENDED DEPLOY SEQUENCE

**Προϋπόθεση**: Niko έχει παράσχει R2 credentials + Vault απόφαση + DNS record.

**Συνολικό ETA από "Niko clicks GO"**: ~2.5-3 ώρες (assuming credentials ready)

```bash
# ================================================================
# PHASE A — Preview server setup (~45 min, μία φορά)
# ================================================================

# A1. SSH στο Preview server
ssh root@89.167.110.132

# A2. Install pnpm + Node 22 (αν δεν υπάρχουν)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 22 && fnm use 22
npm install -g pnpm@latest

# A3. Redis (αν δεν υπάρχει)
docker run -d --name themisos-redis \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  redis:7-alpine

# A4. Vault dev mode (Preview only — NOT production)
# Κατεβάστε vault binary: https://developer.hashicorp.com/vault/downloads
vault server -dev -dev-root-token-id=preview-root-token \
  -dev-listen-address=127.0.0.1:8200 &
# Αρχικοποίηση KV mount (μία φορά)
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=preview-root-token
vault secrets enable -path=kv kv-v2
vault namespace create themisos

# A5. PostgreSQL — δημιουργία DB
psql -U postgres -c "CREATE USER app_user WITH PASSWORD 'CHANGE_ME';"
psql -U postgres -c "CREATE DATABASE themisos_preview OWNER app_user;"

# ================================================================
# PHASE B — Clone + Build (~30 min)
# ================================================================

# B1. Clone repo στο Preview server
mkdir -p /opt/themisos
cd /opt/themisos
git clone git@github.com:mece-gr/themis-os.git . || git pull origin main

# B2. Δημιουργία .env.preview (από template — συμπλήρωσε τιμές)
cp .env.example .env.preview
# Επεξεργασία: DATABASE_URL, VAULT_TOKEN, R2_*, NEXTAUTH_SECRET, NEXTAUTH_URL κ.λπ.

# B3. Build packages πρώτα
pnpm install --frozen-lockfile
pnpm build:packages  # greek-utils dist/ + λοιπά packages

# B4. Build API
pnpm --filter @themisos/api build
# Αναμένεται exit 0 — έλεγξε dist/server.js

# B5. Build Web
cp .env.preview apps/web/.env.local  # Next.js χρειάζεται NEXTAUTH_SECRET κατά build
pnpm --filter @themisos/web build
# Αναμένεται exit 0 — αν αποτύχει, δες logs για missing env var

# ================================================================
# PHASE C — Database Migrations (~10 min)
# ================================================================

# ΠΑΝΤΑ backup πρώτα (ακόμα και σε Preview, η συνήθεια μετράει)
pg_dump -U postgres themisos_preview > /opt/backups/themisos-pre-migrate-$(date +%Y%m%d-%H%M%S).sql

# Migrations σε αυστηρή σειρά
for f in 0000 0001 0002 0003 0004 0005 0006 0007; do
  echo "Applying ${f}..."
  psql -U app_user -d themisos_preview \
    -f packages/db/migrations/${f}_*.sql
done

# Επαλήθευση
psql -U app_user -d themisos_preview \
  -c "\dn" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# ================================================================
# PHASE D — PM2 + Traefik (~20 min)
# ================================================================

# D1. Αντιγραφή env file
cp .env.preview /opt/themisos/.env.production

# D2. Traefik routing (αν Traefik manages Docker labels — adjust for your setup)
# Ή: Χρήση Traefik file provider rules για port 3110 + 4000
# Preview subdomain: preview.themisos.mece.gr

# D3. PM2 start (χωρίς worker — autorestart: false)
pm2 start infra/pm2/ecosystem.config.cjs \
  --env production \
  --only themisos-api,themisos-web
# themisos-worker παραλείπεται (dist/worker.js δεν υπάρχει)

# D4. Verify processes
pm2 list
pm2 logs themisos-api --lines 30
pm2 logs themisos-web --lines 30

# ================================================================
# PHASE E — Health Verification (~10 min)
# ================================================================

# E1. API health
curl -s https://preview.themisos.mece.gr/health
# Αναμενόμενο: {"status":"ok","service":"themisos-api","version":"0.1.0","ts":"..."}

# E2. Web (Next.js)
curl -s -o /dev/null -w "%{http_code}" https://preview.themisos.mece.gr/
# Αναμενόμενο: 200

# E3. API v1 endpoint
curl -s https://preview.themisos.mece.gr/api/v1
# Αναμενόμενο: {"api":"themisos-api","version":"v1","status":"under_construction",...}

# E4. SSL cert check
echo | openssl s_client -servername preview.themisos.mece.gr \
  -connect preview.themisos.mece.gr:443 2>/dev/null \
  | openssl x509 -noout -enddate
```

---

## SMOKE TEST INVOCATION (post-deploy)

```bash
# Minimal — χωρίς DB cleanup (αν δεν έχεις DATABASE_URL accessible)
cd /opt/themisos
THEMIS_API_URL=https://preview.themisos.mece.gr \
  node --experimental-fetch scripts/smoke-test-phase1.mjs

# Πλήρης — με audit log verification + auto cleanup
THEMIS_API_URL=https://preview.themisos.mece.gr \
THEMIS_ADMIN_TOKEN=<admin-token-if-exists> \
DATABASE_URL=postgres://app_user:PASS@localhost:5432/themisos_preview \
  node --experimental-fetch scripts/smoke-test-phase1.mjs

# Dry-run (χωρίς HTTP requests — επαληθεύει μόνο τη λογική)
node --experimental-fetch scripts/smoke-test-phase1.mjs --dry-run
```

**Αναμενόμενα αποτελέσματα** (χωρίς R2/Vault dev config):
- Βήματα 1-4, 6-15: PASS
- Βήμα 5 (document upload): PARTIAL — `ENCRYPTION_ERROR` ή `R2_UPLOAD_ERROR` αποδεκτό, σημαίνει ότι ο κώδικας έφτασε εκεί
- Βήμα 16 (audit log): SKIP αν δεν ορίσεις DATABASE_URL
- Βήμα 17 (cleanup): PASS αν ορίσεις DATABASE_URL

**Smoke test success threshold**: ≥15/17 βήματα PASS ή PARTIAL.

---

## ROLLBACK RUNBOOK

Αν κάτι πάει στραβά μετά το deploy:

```bash
# ROLLBACK A: Κώδικας (PM2)
# Αν το API/Web είναι down μετά το build:
cd /opt/themisos
git log --oneline -5   # Βρες το previous working commit
git checkout <previous-sha>
pnpm build:packages
pnpm --filter @themisos/api build
pnpm --filter @themisos/web build
pm2 reload themisos-api themisos-web

# ROLLBACK B: Αν τίποτα δεν ξεκινά
pm2 stop all
# Ελέγξτε logs:
pm2 logs themisos-api --lines 50
pm2 logs themisos-web --lines 50
# Πιθανές αιτίες: missing .env, port conflict, DB unreachable

# ROLLBACK C: Database migrations (αν migration έσπασε κάτι)
# Χρησιμοποιείστε το pre-migration backup:
psql -U postgres -c "DROP DATABASE IF EXISTS themisos_preview;"
psql -U postgres -c "CREATE DATABASE themisos_preview OWNER app_user;"
psql -U app_user -d themisos_preview < /opt/backups/themisos-pre-migrate-<timestamp>.sql
# Re-apply μέχρι το σωστό migration

# POST-ROLLBACK: Επαλήθευση
curl -s https://preview.themisos.mece.gr/health
pm2 list
```

---

## KNOWN LIMITATIONS ΓΙΑ PREVIEW (αποδεκτά)

Τα παρακάτω δεν είναι blockers για Preview αλλά θα λείπουν:

| Feature | Status στο Preview | Αιτία |
|---------|------------------|-------|
| Document OCR / fulltext search | Non-functional | Worker entry point δεν υπάρχει (src/worker.ts) |
| Email delivery (register/reset) | Non-functional | RESEND_API_KEY pending |
| PII encryption (names, AFM) | Plaintext | Deferred to Phase 1.5 |
| /api/v1/auth/refresh | 404 | Decision pending |
| Tenant refresh tokens | Hard 8h logout | Συνδέεται με το παραπάνω |
| RLS policies | Absent | Phase 1.5 |
| Audit log query endpoint | 404 | Phase 1.5 |
| 9 ΚΠολΔ rules | BETA banner | Themis review pending |
| Vault HA | In-memory (dev mode) | Production: dedicated CX22 |

---

## GO/NO-GO CHECKLIST

Πριν ο Ερμης ξεκινήσει actual deploy, απαιτούνται:

```
[ ] R2 credentials παρεχόμενα από Niko
[ ] Vault decision (dev mode OK για Preview)
[ ] DNS A record preview.themisos.mece.gr → 89.167.110.132 active
[ ] .env.preview file created + NEXTAUTH_SECRET generated
[ ] Niko confirms: Preview είναι OK με known limitations παραπάνω
```

**Αν ΟΛΑ checked → GO. Αν έστω ένα NO → NO-GO.**

---

*Αξιολόγηση βασισμένη σε: phase-1-completion-report.md, phase-1-known-issues.md,
phase-1-gaps-ranked.json, day10b-quick-wins-report.md, smoke-test-phase1.mjs,
infra/pm2/ecosystem.config.cjs, infra/nginx/themisos.conf.template, apps/api/src/server.ts,
.env.example — χωρίς εκτέλεση κανενός build command.*
