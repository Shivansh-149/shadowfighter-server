#!/usr/bin/env bash
# Creates an always-on (Starter plan) Render web service with a 24-character admin key.
set -euo pipefail
: "${RENDER_API_KEY:?Run: export RENDER_API_KEY='rnd_...' first}"
REPO="${1:?Usage: ./deploy_render_247.sh https://github.com/USER/REPO}"
NAME="${2:-shadowfighter-server}"
API=https://api.render.com/v1
ADMIN_KEY=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')   # 24 hex characters

# req METHOD PATH [JSON] -> full response, status code on the last line
req() {
  local m=$1 p=$2 d=${3:-}
  if [ -n "$d" ]; then
    curl -sS -w '\n%{http_code}' -X "$m" -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Content-Type: application/json" -H "Accept: application/json" -d "$d" "$API$p"
  else
    curl -sS -w '\n%{http_code}' -X "$m" -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Accept: application/json" "$API$p"
  fi
}
# check RESPONSE -> sets BODY, exits on HTTP error
check() {
  CODE=$(printf '%s' "$1" | tail -n1)
  BODY=$(printf '%s' "$1" | sed '$d')
  if [ "$CODE" -ge 300 ]; then echo "Render error HTTP $CODE: $BODY"; exit 1; fi
}

echo "Checking API key..."
R=$(req GET "/owners?limit=1"); check "$R"
OWNER=$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].owner.id))')
echo "Workspace: $OWNER"

PAYLOAD=$(node -e 'console.log(JSON.stringify({
  type:"web_service", name:process.argv[1], ownerId:process.argv[2], repo:process.argv[3],
  branch:"main", autoDeploy:"yes", rootDir:".",
  serviceDetails:{ runtime:"node", plan:"free", region:"oregon", healthCheckPath:"/api/health",
    envSpecificDetails:{ buildCommand:"npm install", startCommand:"node server.js" } }
}))' "$NAME" "$OWNER" "$REPO")

echo "Creating always-on (Starter) service..."
R=$(req POST "/services" "$PAYLOAD"); check "$R"
SID=$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.service||j).id)})')
URL=$(printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=j.service||j;console.log((v.serviceDetails&&v.serviceDetails.url)||("https://"+v.slug+".onrender.com"))})')

echo "Setting admin key and data path..."
R=$(req PUT "/services/$SID/env-vars/ADMIN_KEY" "{\"value\":\"$ADMIN_KEY\"}"); check "$R"

echo
echo "Service ID : $SID"
echo "Server URL : $URL"
echo "Dashboard  : https://dashboard.render.com/web/$SID"
echo "Admin key  : $ADMIN_KEY   <- save this"
echo
echo "NEXT (in the Render dashboard):"
echo "  1. Open the service > Disks > Add disk. Mount path: /var/data  Size: 1 GB"
echo "  2. Wait for the first deploy to finish (a few minutes)."
echo "  3. Check: curl $URL/api/health"
