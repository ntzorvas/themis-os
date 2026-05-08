#!/usr/bin/env bash
# =============================================================================
# post-deploy-traefik.sh — Auto-update Traefik config after Coolify deploy
# =============================================================================
# Run ON the Preview server (89.167.110.132) after each Coolify deploy.
# Detects current Coolify container names and updates Traefik dynamic config.
#
# Usage:
#   ssh root@89.167.110.132 'bash /root/scripts/post-deploy-traefik.sh'
#   # OR from local:
#   ./scripts/coolify.sh deploy-web && ssh root@89.167.110.132 'bash /root/scripts/post-deploy-traefik.sh'
# =============================================================================

set -euo pipefail

TRAEFIK_CONFIG="/root/traefik/config/dynamic/themis.yml"
API_UUID_PREFIX="wsv510cb01sdgxhxiru31o5l"
WEB_UUID_PREFIX="p2rwwe9d48z8b32be3ivwafg"

# Find current running container names
API_CONTAINER=$(docker ps --filter "name=${API_UUID_PREFIX}" --format '{{.Names}}' | head -1)
WEB_CONTAINER=$(docker ps --filter "name=${WEB_UUID_PREFIX}" --format '{{.Names}}' | head -1)

if [ -z "$API_CONTAINER" ] && [ -z "$WEB_CONTAINER" ]; then
  echo "ERROR: No ΘΕΜΙΣ containers found running"
  exit 1
fi

echo "Detected containers:"
[ -n "$API_CONTAINER" ] && echo "  API: $API_CONTAINER"
[ -n "$WEB_CONTAINER" ] && echo "  Web: $WEB_CONTAINER"

# Backup
cp "$TRAEFIK_CONFIG" "${TRAEFIK_CONFIG}.bak"

# Update API URL if container found
if [ -n "$API_CONTAINER" ]; then
  # Replace any wsv510... container name in the config
  sed -i "s|http://${API_UUID_PREFIX}[^:]*:4100|http://${API_CONTAINER}:4100|g" "$TRAEFIK_CONFIG"
  # Also replace legacy manual container name
  sed -i "s|http://themis-api-fixed:4100|http://${API_CONTAINER}:4100|g" "$TRAEFIK_CONFIG"
fi

# Update Web URL if container found
if [ -n "$WEB_CONTAINER" ]; then
  sed -i "s|http://${WEB_UUID_PREFIX}[^:]*:3501|http://${WEB_CONTAINER}:3501|g" "$TRAEFIK_CONFIG"
fi

echo ""
echo "Updated Traefik config:"
grep "url:" "$TRAEFIK_CONFIG"

# Verify Traefik picks it up (file provider auto-reloads)
echo ""
echo "Traefik will auto-reload within ~5s (file provider watch)"

# Quick health check
sleep 3
echo ""
echo "Health check:"
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' https://themis.mentorist.gr/health 2>/dev/null || echo "ERR")
DASH=$(curl -s -o /dev/null -w '%{http_code}' https://themis.mentorist.gr/dashboard 2>/dev/null || echo "ERR")
echo "  /health    → $HEALTH"
echo "  /dashboard → $DASH"
