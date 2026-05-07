# Day 5 — HashiCorp Vault Setup Runbook

**Status:** REFERENCE — not yet executed  
**Author:** Δαίδαλος  
**Date:** 2026-04-29  
**Spec ref:** docs/v03/tech-stack-v03.md §17.1  
**Cost:** ~€7/month (Hetzner CX22) + ~€1/month (AWS KMS Frankfurt, recovery seal only)

---

## 0. Overview

ΘΕΜΙΣ OS / ΘΕΜΙΣ OS uses HashiCorp Vault to manage per-firm Data Encryption Keys (DEKs).
Vault is the ONLY system that holds key material. Postgres stores only Vault path references.

**Architecture:**
```
[Fastify API on Bridge] ──WireGuard──► [Vault CX22 Helsinki]
                                              │
                                        KV-v2 engine
                                        firms/<slug>/dek   ← data_encryption DEK
                                        firms/<slug>/pek   ← privilege_encryption DEK (Phase 2)
```

**Vault instance details:**
- **VM:** Hetzner CX22 (2 vCPU, 4 GB RAM, 40 GB SSD) — Helsinki region
- **OS:** Ubuntu 24.04 LTS
- **Storage backend:** Integrated Raft (single-node, Phase 1)
- **Reachable from Bridge:** WireGuard VPN only (NOT public internet)
- **TLS:** Self-signed cert on localhost, Caddy reverse-proxy for external hostname (vault.themisos.gr, WireGuard-only)

---

## 1. Install Vault on Hetzner CX22

SSH into the Vault VM. All commands run as root unless noted.

### Option A — HashiCorp apt repository (recommended)

```bash
apt-get update && apt-get install -y gpg curl

# Add HashiCorp GPG key and apt repository
curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
  https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  > /etc/apt/sources.list.d/hashicorp.list

apt-get update && apt-get install -y vault

# Verify
vault version
# Expected: Vault v1.18.x
```

### Option B — Binary download

```bash
VAULT_VERSION="1.18.3"
curl -fsSLO "https://releases.hashicorp.com/vault/${VAULT_VERSION}/vault_${VAULT_VERSION}_linux_amd64.zip"
unzip vault_${VAULT_VERSION}_linux_amd64.zip
mv vault /usr/local/bin/vault
chmod +x /usr/local/bin/vault
vault version
```

---

## 2. Configure Vault (Integrated Raft, single-node)

### 2.1 Create the Vault config file

```bash
mkdir -p /etc/vault.d /opt/vault/data
cat > /etc/vault.d/vault.hcl << 'EOF'
ui            = false
disable_mlock = false

storage "raft" {
  path    = "/opt/vault/data"
  node_id = "vault-themisos-node1"
}

listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/etc/vault.d/tls/vault.crt"
  tls_key_file  = "/etc/vault.d/tls/vault.key"
}

# Recovery seal: AWS KMS Frankfurt.
# This is OPERATIONAL CONVENIENCE (auto-unseal on VM restart) NOT data encryption.
# The Shamir manual unseal always works independently of AWS.
# Replace <KMS_KEY_ID> with the actual ARN after creating the key in eu-central-1.
seal "awskms" {
  region     = "eu-central-1"
  kms_key_id = "<KMS_KEY_ARN>"
}

api_addr     = "https://vault.themisos.gr:8200"
cluster_addr = "https://vault.themisos.gr:8201"
EOF
```

### 2.2 Generate self-signed TLS cert (dev/staging only; use ACM or Let's Encrypt in prod)

```bash
mkdir -p /etc/vault.d/tls
openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout /etc/vault.d/tls/vault.key \
  -out    /etc/vault.d/tls/vault.crt \
  -days   365 \
  -subj   "/CN=vault.themisos.gr" \
  -addext "subjectAltName=DNS:vault.themisos.gr,IP:127.0.0.1"

chmod 640 /etc/vault.d/tls/vault.key
```

### 2.3 Create systemd service

```bash
cat > /etc/systemd/system/vault.service << 'EOF'
[Unit]
Description=HashiCorp Vault
Documentation=https://developer.hashicorp.com/vault
Requires=network-online.target
After=network-online.target

[Service]
Type=notify
User=vault
Group=vault
ExecStart=/usr/bin/vault server -config=/etc/vault.d/vault.hcl
ExecReload=/bin/kill --signal HUP $MAINPID
KillMode=process
KillSignal=SIGINT
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
LimitNOFILE=65536
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF

useradd --system --home /etc/vault.d --shell /bin/false vault
chown -R vault:vault /etc/vault.d /opt/vault/data

systemctl daemon-reload
systemctl enable vault
systemctl start vault
systemctl status vault
```

---

## 3. Initialize Vault

Initialize ONCE on a fresh Vault cluster. Generates Shamir unseal keys and initial root token.

```bash
export VAULT_ADDR="https://127.0.0.1:8200"
export VAULT_SKIP_VERIFY="true"   # only for self-signed cert; remove in prod with proper CA

# Initialize with Shamir 5-of-9 parameters.
vault operator init \
  -key-shares=9 \
  -key-threshold=5 \
  -format=json > /root/vault-init-output.json

# CRITICAL: vault-init-output.json contains ALL 9 unseal key shares + the root token.
# This file must be processed immediately:
#   1. Copy the root_token to /root/.secrets/vault-root-token (chmod 400).
#   2. Distribute unseal shares per §7 (Shamir custody) below.
#   3. SHRED this file: shred -uzn 10 /root/vault-init-output.json
# DO NOT leave vault-init-output.json on disk after share distribution.

# Extract root token for immediate use
ROOT_TOKEN=$(jq -r .root_token /root/vault-init-output.json)
echo "$ROOT_TOKEN" > /root/.secrets/vault-root-token
chmod 400 /root/.secrets/vault-root-token
```

---

## 4. Unseal Flow (3 of 5 Shamir shares)

On every Vault restart (VM reboot, crash recovery), Vault starts in sealed state.
With the AWS KMS auto-unseal configured in §2.1, manual unseal is NOT needed for
normal restarts — AWS KMS automatically provides the master key.

Manual unseal (fallback — if AWS KMS is unreachable):

```bash
export VAULT_ADDR="https://127.0.0.1:8200"
export VAULT_SKIP_VERIFY="true"

# Repeat for 5 different shares (each holder runs this once with their share)
vault operator unseal <SHARE_1>
vault operator unseal <SHARE_2>
vault operator unseal <SHARE_3>
vault operator unseal <SHARE_4>
vault operator unseal <SHARE_5>

# Verify sealed=false
vault status
```

---

## 5. Production Setup: AppRole Auth + KV-v2 Mount

Run these commands with the root token (initial setup only).
After setup, the root token is REVOKED and stored in the escrow (§7).

```bash
export VAULT_ADDR="https://127.0.0.1:8200"
export VAULT_TOKEN="$(cat /root/.secrets/vault-root-token)"
export VAULT_SKIP_VERIFY="true"

# 5.1 Enable KV-v2 secrets engine
vault secrets enable -path=kv kv-v2

# 5.2 Enable AppRole auth method (for Fastify API process)
vault auth enable approle

# 5.3 Create policy: themisos-app
# Allows read/write to kv/firms/*/dek and kv/firms/*/pek only.
# Cannot access other paths (principle of least privilege).
cat > /tmp/themisos-app.hcl << 'EOF'
# Read and write DEKs for all firms
path "kv/data/firms/*" {
  capabilities = ["create", "read", "update", "list"]
}

# Read specific versions for DEK rotation
path "kv/data/firms/+/dek" {
  capabilities = ["create", "read", "update", "list"]
}

path "kv/data/firms/+/pek" {
  capabilities = ["create", "read", "update", "list"]
}

# Deny all other paths
path "*" {
  capabilities = ["deny"]
}
EOF

vault policy write themisos-app /tmp/themisos-app.hcl
rm /tmp/themisos-app.hcl

# 5.4 Create AppRole for Fastify API
vault write auth/approle/role/themisos-api \
  token_ttl=1h \
  token_max_ttl=4h \
  token_policies=themisos-app \
  secret_id_ttl=0        # non-expiring secret_id; rotate manually each 90 days

# 5.5 Retrieve role-id and generate secret-id
ROLE_ID=$(vault read -field=role_id auth/approle/role/themisos-api/role-id)
SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/themisos-api/secret-id)

# Store in Bridge secrets directory
echo "VAULT_ROLE_ID=${ROLE_ID}" >> /root/.secrets/themis-vault.env
echo "VAULT_SECRET_ID=${SECRET_ID}" >> /root/.secrets/themis-vault.env
chmod 400 /root/.secrets/themis-vault.env

# 5.6 Test AppRole login
vault write auth/approle/login role_id="${ROLE_ID}" secret_id="${SECRET_ID}"

# 5.7 Revoke root token (store encrypted copy in escrow first — see §7)
# vault token revoke "${VAULT_TOKEN}"
# WARNING: Only revoke after escrow is confirmed.
```

### AppRole Login in Application Code

The Fastify API uses the AppRole flow to obtain a short-lived token:

```bash
# PM2 startup script performs login and exports VAULT_TOKEN
VAULT_TOKEN=$(vault write -field=token auth/approle/login \
  role_id="${VAULT_ROLE_ID}" \
  secret_id="${VAULT_SECRET_ID}")
export VAULT_TOKEN
```

Phase 1 shortcut: use a long-lived token stored in `/root/.secrets/themis-vault.env`.
Rotate to full AppRole flow before first paying customer.

---

## 6. Backup Strategy: Vault Raft Snapshot to R2

Vault Integrated Raft exposes a snapshot API. Snapshots are encrypted by Vault's
barrier key (the same key protected by the Shamir unseal shares).

### Automated daily backup

```bash
# /root/scripts/vault-snapshot.sh
#!/usr/bin/env bash
set -euo pipefail

VAULT_ADDR="https://127.0.0.1:8200"
VAULT_TOKEN="$(cat /root/.secrets/vault-root-token)"
SNAPSHOT_DATE=$(date +%Y%m%d-%H%M%S)
SNAPSHOT_FILE="/tmp/vault-snapshot-${SNAPSHOT_DATE}.snap"

# Take snapshot
vault operator raft snapshot save "${SNAPSHOT_FILE}"

# Upload to R2 backups bucket
# Uses aws-cli configured for Cloudflare R2 (see .env.example R2_* vars)
aws s3 cp "${SNAPSHOT_FILE}" \
  "s3://themisos-backups/vault/daily/${SNAPSHOT_DATE}.snap" \
  --endpoint-url "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"

rm -f "${SNAPSHOT_FILE}"
echo "Vault snapshot uploaded: vault/daily/${SNAPSHOT_DATE}.snap"
```

Add to cron (Bridge server, root crontab):
```
0 2 * * * /root/scripts/vault-snapshot.sh >> /var/log/vault-backup.log 2>&1
```

### Restore procedure

```bash
# On a fresh Vault VM (after init + unseal):
vault operator raft snapshot restore /path/to/snapshot.snap
# Vault immediately resumes from snapshot state.
# All DEK data restored — no re-provisioning of firm keys needed.
```

---

## 7. Shamir's Secret Sharing — ROOT TOKEN Custody (5-of-9)

**Context:** The Vault root token is generated once at `vault operator init`.
After distributing the 9 unseal key shares, the root token must be stored
so it can be reconstructed only with quorum agreement.

**Reconstruction threshold:** 5 of 9 shares.

### Share holder roster (placeholder — Niko to confirm)

| Share # | Holder | Custody method |
|---------|--------|----------------|
| 1 | Νικόλαος (Niko) | YubiKey hardware token |
| 2 | Δαίδαλος ops escrow | Encrypted in `/root/.secrets/vault-share-escrow.gpg` (Niko-only GPG key) |
| 3 | Περικλής (legal arch) | Encrypted in ops escrow + notary copy |
| 4 | Niko's spouse / trusted family | Sealed physical envelope, notarised |
| 5 | Niko's accountant office | Sealed physical envelope |
| 6 | **RESERVED** — rotation-only share | Sealed, time-locked (print date) |
| 7 | **RESERVED** — rotation-only share | Sealed, time-locked |
| 8 | **RESERVED** — rotation-only share | Sealed, time-locked |
| 9 | **RESERVED** — rotation-only share | Sealed, time-locked |

**Time-locked rotation drill:** every 6 months. Participants must confirm
their share is intact. Tracked in `public.firm_kms_keys` audit trail.

### Practical distribution process

1. Run `vault operator init` → captures JSON output with `unseal_keys_b64[]` (9 entries).
2. Each share is a base64-encoded 32-byte value — print as QR code + mnemonic for resilience.
3. Deliver each share to its holder in person or via encrypted channel (Signal, GPG email).
4. Holder acknowledges receipt in writing (email confirmation is sufficient for Phase 1;
   notary act optional for Enterprise-grade requirement).
5. Shred the init output file on the Vault VM: `shred -uzn 10 /root/vault-init-output.json`.

**Recovery reconstruction:**

```bash
# Each of the 5+ holders submits their share independently.
# Coordinator (Niko or Δαίδαλος) collects and runs:
vault operator unseal <share_1>
vault operator unseal <share_2>
vault operator unseal <share_3>
vault operator unseal <share_4>
vault operator unseal <share_5>
# After 5 shares: Vault is unsealed. Root token not needed for unseal.
```

To reconstruct the root token itself (admin operations, emergency):
```bash
vault operator generate-root -init
# Follows same 5-of-9 quorum process, generates OTP-encrypted root token.
# See: https://developer.hashicorp.com/vault/docs/commands/operator/generate-root
```

---

## 8. Phase 2: Customer-Managed Vault (BYOK Enterprise)

> Estimated availability: 2026-Q3. Requires sign-off on Q-TS-6 (BYOK pricing).

**Architecture:**

```
[Customer law firm IT]       [ΘΕΜΙΣ OS Bridge]
       │                            │
  Customer Vault                 MECE Vault
  (self-hosted or                (Hetzner CX22)
   HashiCorp Cloud)                   │
       │                              │
  privilege_encryption DEK    data_encryption DEK
       │                              │
       └──── per-document DDK ────────┘
                    │
              R2 ciphertext
```

**BYOK flow:**
1. Customer provisions their own Vault instance (self-hosted or HCP Vault).
2. Customer creates a `themisos-privilege` AppRole in their Vault.
3. Customer shares the `role-id` + `secret-id` via the ΘΕΜΙΣ OS Enterprise setup wizard.
4. ΘΕΜΙΣ OS stores the customer Vault endpoint + credentials (encrypted with MECE DEK) in `firm_settings.byok_vault_config`.
5. `PrivilegeKeyNotConfiguredError` is replaced by a live customer Vault call for `privilege_encryption` key operations.

**Shamir custody for BYOK (Enterprise opt-in):**
- Browser-side WebCrypto + `shamirs-secret-sharing` npm library.
- 3-of-5 share scheme per firm (NOT 5-of-9 — firm controls their own threshold).
- Shares distributed as 24-word mnemonics (BIP39-style) + QR codes.
- Quarterly reconstruction drill tracked in `kms_custody_share.last_recovery_drill_at`.
- Greek notary act (συμβολαιογραφική πράξη) optional but available via integration.

---

## 9. Health Check

```bash
# From Bridge (via WireGuard)
curl -sk https://vault.themisos.gr:8200/v1/sys/health | jq '{initialized, sealed, standby}'

# Expected healthy response:
# { "initialized": true, "sealed": false, "standby": false }
```

Prometheus metric endpoint (if vault-exporter deployed):
```
scrape_configs:
  - job_name: vault
    static_configs:
      - targets: ['vault.themisos.gr:9410']
```

---

## 10. Cost Summary

| Item | Monthly cost | Notes |
|------|-------------|-------|
| Hetzner CX22 (Helsinki) | €7.00 | Dedicated VM, NOT shared with Bridge |
| AWS KMS Frankfurt (recovery seal) | ~€1.00 | ~$0.03/10K API calls, pay-per-use |
| R2 snapshot storage (~5 GB) | ~€0.08 | Negligible |
| **Total** | **~€8.08** | |

Switch to Hetzner KMS native when available (~Q3 2026) to eliminate AWS dependency.
See Q-TS-7 in tech-stack-v03.md §17.8 for rationale.
