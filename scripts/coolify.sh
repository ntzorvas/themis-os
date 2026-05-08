#!/usr/bin/env bash
# =============================================================================
# coolify.sh — ΘΕΜΙΣ OS Coolify Management Script
# =============================================================================
# Usage: ./scripts/coolify.sh <command> [options]
#
# Commands:
#   status              Show status of all ΘΕΜΙΣ apps
#   deploy-web          Deploy web app (rebuild from git)
#   deploy-api          Deploy API app (rebuild from git)
#   deploy-all          Deploy both web and API
#   restart-web         Restart web container (no rebuild)
#   restart-api         Restart API container (no rebuild)
#   logs-web [N]        Show last N lines of web deployment log
#   logs-api [N]        Show last N lines of API deployment log
#   envs-api            Show API environment variables
#   envs-web            Show web environment variables
#   set-env-api K V     Set a single API env var
#   deployments [N]     List recent deployments (default: 5)
#   watch <uuid>        Poll deployment status until done
#   containers          Show running ΘΕΜΙΣ containers
#   networks            Check Docker network connectivity
#   health              Full health check (API + Web + DB)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

COOLIFY_URL="${COOLIFY_URL:-https://coolify.mentorist.gr}"
COOLIFY_TOKEN="${COOLIFY_TOKEN:-7|6c4f8b4257cdc3278e8853b9bb37a48dc4eda552fc05284345f9b2ee78d6661b}"
WEB_UUID="p2rwwe9d48z8b32be3ivwafg"
API_UUID="wsv510cb01sdgxhxiru31o5l"
DOMAIN="themis.mentorist.gr"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

api() {
  local method="$1" endpoint="$2"
  shift 2
  curl -s -X "$method" \
    "${COOLIFY_URL}/api/v1${endpoint}" \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

json_field() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))"
}

print_header() {
  echo ""
  echo "━━━ $1 ━━━"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_status() {
  print_header "ΘΕΜΙΣ OS — App Status"

  echo ""
  echo "Web (${WEB_UUID}):"
  api GET "/applications/${WEB_UUID}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  Status:  {d.get('status','?')}\" )
print(f\"  FQDN:    {d.get('fqdn','?')}\")
print(f\"  Branch:  {d.get('git_branch','?')}\")
"

  echo ""
  echo "API (${API_UUID}):"
  api GET "/applications/${API_UUID}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  Status:  {d.get('status','?')}\")
print(f\"  FQDN:    {d.get('fqdn','?')}\")
print(f\"  Branch:  {d.get('git_branch','?')}\")
"
}

cmd_deploy() {
  local uuid="$1" name="$2"
  print_header "Deploying ${name}"

  local result
  result=$(api POST "/deploy?uuid=${uuid}&force=true")
  local dep_uuid
  dep_uuid=$(echo "$result" | python3 -c "
import sys,json
d=json.load(sys.stdin)
deps=d.get('deployments',[])
if deps: print(deps[0].get('deployment_uuid',''))
else: print('')
" 2>/dev/null)

  if [ -z "$dep_uuid" ]; then
    echo "  ERROR: Deploy failed"
    echo "  Response: $result"
    return 1
  fi

  echo "  Deployment queued: ${dep_uuid}"
  echo "  Watching..."
  cmd_watch "$dep_uuid"
}

cmd_restart() {
  local uuid="$1" name="$2"
  print_header "Restarting ${name}"
  api POST "/applications/${uuid}/restart" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  {d.get('message','?')}\")
dep=d.get('deployment_uuid','')
if dep: print(f'  Deployment: {dep}')
"
}

cmd_watch() {
  local dep_uuid="$1"
  local max_wait=300  # 5 minutes
  local elapsed=0
  local interval=10

  while [ $elapsed -lt $max_wait ]; do
    local status
    status=$(api GET "/deployments/${dep_uuid}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d.get('status','unknown'))
" 2>/dev/null)

    case "$status" in
      finished)
        echo "  ✓ Deploy finished (${elapsed}s)"
        return 0
        ;;
      failed)
        echo "  ✗ Deploy FAILED (${elapsed}s)"
        echo "  Check logs: ./scripts/coolify.sh logs-web"
        return 1
        ;;
      cancelled)
        echo "  ⊘ Deploy cancelled (${elapsed}s)"
        return 1
        ;;
      *)
        printf "  [%3ds] %s...\r" "$elapsed" "$status"
        ;;
    esac

    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  echo "  ⚠ Timeout after ${max_wait}s (status: ${status})"
  return 1
}

cmd_logs() {
  local uuid="$1" name="$2" lines="${3:-50}"
  print_header "${name} — Last deployment log (${lines} lines)"

  # Get most recent deployment UUID
  local dep_uuid
  dep_uuid=$(api GET "/applications/${uuid}/deployments?per_page=1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get('data',[])
if items: print(items[0].get('deployment_uuid',''))
" 2>/dev/null)

  if [ -z "$dep_uuid" ]; then
    echo "  No deployments found"
    return
  fi

  echo "  Deployment: ${dep_uuid}"
  api GET "/deployments/${dep_uuid}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  Status: {d.get('status','?')}\")
log=d.get('logs','')
if log:
    lines=log.strip().split('\n')
    for l in lines[-${lines}:]:
        print(f'  {l}')
else:
    print('  (no logs available)')
"
}

cmd_envs() {
  local uuid="$1" name="$2"
  print_header "${name} — Environment Variables"
  api GET "/applications/${uuid}/envs" | python3 -c "
import sys,json
data=json.load(sys.stdin)
seen=set()
for e in data:
    k=e['key']
    v=e['value']
    if k in seen:
        print(f'  [DUP] {k} = {v}')
    else:
        # mask secrets
        if any(s in k.lower() for s in ['password','secret','token']):
            masked = v[:8] + '...' if len(v)>8 else '****'
            print(f'  {k} = {masked}')
        else:
            print(f'  {k} = {v}')
    seen.add(k)
"
}

cmd_set_env() {
  local uuid="$1" key="$2" value="$3"
  api POST "/applications/${uuid}/envs" \
    -d "{\"key\":\"${key}\",\"value\":\"${value}\",\"is_preview\":false}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
msg=d.get('message', d.get('key','?'))
print(f'  Set: {msg}')
"
}

cmd_deployments() {
  local count="${1:-5}"
  print_header "Recent Deployments (last ${count})"

  for app_name in "web:${WEB_UUID}" "api:${API_UUID}"; do
    local name="${app_name%%:*}"
    local uuid="${app_name##*:}"
    echo ""
    echo "  ${name}:"
    api GET "/applications/${uuid}/deployments?per_page=${count}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get('data',[])
for i,dep in enumerate(items):
    status=dep.get('status','?')
    created=dep.get('created_at','?')[:19]
    uuid=dep.get('deployment_uuid','?')[:12]
    symbol='✓' if status=='finished' else '✗' if status=='failed' else '…'
    print(f'    {symbol} {created}  {status:<10}  {uuid}')
"
  done
}

cmd_containers() {
  print_header "Running ΘΕΜΙΣ Containers"
  docker ps --filter "name=themis" --filter "name=p2rwwe" --filter "name=wsv510" --filter "name=vault" \
    --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
    echo "  (run this on the server directly)"
}

cmd_networks() {
  print_header "Docker Network Check"
  echo "  coolify network members:"
  docker network inspect coolify --format '{{range .Containers}}  - {{.Name}}{{"\n"}}{{end}}' 2>/dev/null || \
    echo "  (run this on the server directly)"
}

cmd_health() {
  print_header "ΘΕΜΙΣ OS — Health Check"

  echo ""
  echo "  Endpoints:"

  local health_code health_body
  health_code=$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/health")
  health_body=$(curl -s "https://${DOMAIN}/health" 2>/dev/null | head -c 200)
  printf "  %-30s %s  %s\n" "GET /health" "$health_code" "$health_body"

  local api_code api_body
  api_code=$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/v1")
  api_body=$(curl -s "https://${DOMAIN}/api/v1" 2>/dev/null | head -c 200)
  printf "  %-30s %s  %s\n" "GET /api/v1" "$api_code" "$api_body"

  local login_code
  login_code=$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/login")
  printf "  %-30s %s\n" "GET /login" "$login_code"

  local dash_code
  dash_code=$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/dashboard")
  printf "  %-30s %s\n" "GET /dashboard" "$dash_code"

  echo ""
  echo "  Login test:"
  local login_result
  login_result=$(curl -s -X POST "https://${DOMAIN}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@demo.themisos.gr","password":"demo1234demo"}' 2>/dev/null)
  local has_token
  has_token=$(echo "$login_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print('YES' if d.get('token') else 'NO')" 2>/dev/null || echo "PARSE_ERROR")
  if [ "$has_token" = "YES" ]; then
    echo "  ✓ Login OK — JWT token received"
  else
    echo "  ✗ Login FAILED"
    echo "  Response: $(echo "$login_result" | head -c 200)"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

CMD="${1:-help}"
shift || true

case "$CMD" in
  status)        cmd_status ;;
  deploy-web)    cmd_deploy "$WEB_UUID" "Web" ;;
  deploy-api)    cmd_deploy "$API_UUID" "API" ;;
  deploy-all)    cmd_deploy "$API_UUID" "API" && cmd_deploy "$WEB_UUID" "Web" ;;
  restart-web)   cmd_restart "$WEB_UUID" "Web" ;;
  restart-api)   cmd_restart "$API_UUID" "API" ;;
  logs-web)      cmd_logs "$WEB_UUID" "Web" "${1:-50}" ;;
  logs-api)      cmd_logs "$API_UUID" "API" "${1:-50}" ;;
  envs-api)      cmd_envs "$API_UUID" "API" ;;
  envs-web)      cmd_envs "$WEB_UUID" "Web" ;;
  set-env-api)   cmd_set_env "$API_UUID" "${1:?key required}" "${2:?value required}" ;;
  set-env-web)   cmd_set_env "$WEB_UUID" "${1:?key required}" "${2:?value required}" ;;
  deployments)   cmd_deployments "${1:-5}" ;;
  watch)         cmd_watch "${1:?deployment_uuid required}" ;;
  containers)    cmd_containers ;;
  networks)      cmd_networks ;;
  health)        cmd_health ;;
  help|--help|-h)
    head -20 "$0" | tail -18
    ;;
  *)
    echo "Unknown command: $CMD"
    echo "Run: $0 help"
    exit 1
    ;;
esac
