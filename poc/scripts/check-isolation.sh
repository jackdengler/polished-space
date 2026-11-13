#!/bin/sh
# ============================================================================
#  Isolation check for the Docker sandbox (plan 3.3).
#  MUST BE RUN ON THE LAPTOP, after `npm --prefix poc run up`.
#  It could not be run where it was written (no Docker daemon there).
# ============================================================================
#
#   sh poc/scripts/check-isolation.sh
#
# Checks:
#   1. From inside pm, mocks, brain and speech, a request to an outside host fails
#      (including api.anthropic.com directly: Claude is reachable only via the gateway).
#   2. From brain, a request through the gateway reaches the Claude API
#      (HTTP 200 with a key in poc/.env, or Anthropic's own 401 without one).
#   3. The gateway refuses any other upstream: a different Host header, an
#      absolute-URL (forward-proxy style) request and CONNECT all still end at
#      api.anthropic.com or are refused; nothing reaches example.com.
#   4. The sandbox network is internal; only the gateway is on the edge network.
#   5. Host ports listen on 127.0.0.1 only, and only the gateway publishes any.
#
# The API key is never printed: it is only read inside the brain container.
set -u
cd "$(dirname "$0")/.." || exit 2
DC="docker compose -f docker-compose.yml"
FAIL=0
pass() { printf '  \342\234\223 %s\n' "$1"; }
fail() { printf '  \342\234\227 %s\n' "$1"; FAIL=1; }

if ! docker info >/dev/null 2>&1; then echo "Docker is not running."; exit 2; fi
for s in gateway pm mocks brain speech; do
  if [ -z "$($DC ps -q --status running "$s" 2>/dev/null)" ]; then echo "Service $s is not running. Start the sandbox first: npm --prefix poc run up"; exit 2; fi
done

echo "1. No outside access from the service containers"
# Exit 0 = the request FAILED (good). Exit 1 = it got an answer (bad).
OUTSIDE='const u=process.argv[1];fetch(u,{signal:AbortSignal.timeout(6000)}).then(()=>process.exit(1),()=>process.exit(0))'
for s in pm mocks brain speech; do
  for u in https://example.com/ https://api.anthropic.com/v1/models http://1.1.1.1/; do
    if $DC exec -T "$s" node -e "$OUTSIDE" "$u" >/dev/null 2>&1; then pass "$s cannot reach $u"; else fail "$s REACHED $u"; fi
  done
done

echo "2. Brain -> gateway -> Claude"
CLAUDE='fetch("http://gateway:8443/v1/models",{headers:{"x-api-key":process.env.ANTHROPIC_API_KEY||"none","anthropic-version":"2023-06-01"},signal:AbortSignal.timeout(15000)}).then(async r=>{const t=await r.text();const fromAnthropic=!!r.headers.get("request-id")||/"type":"error"/.test(t);console.log(r.status+" "+(fromAnthropic?"anthropic":"other"));process.exit(fromAnthropic&&(r.status===200||r.status===401)?0:1)},e=>{console.log("error "+(e.cause?.code||e.message));process.exit(1)})'
OUT=$($DC exec -T brain node -e "$CLAUDE" 2>&1)
case "$OUT" in
  "200 anthropic"*) pass "brain reached the Claude API through the gateway (200)";;
  "401 anthropic"*) pass "brain reached the Claude API through the gateway (401: no valid key in poc/.env, but the route works)";;
  *) fail "brain could not reach Claude through the gateway: $OUT";;
esac

echo "3. The gateway forwards to api.anthropic.com only"
OTHER='
const http=require("node:http");const net=require("node:net");
const ask=(opts)=>new Promise(r=>{const q=http.request({host:"gateway",port:8443,timeout:15000,...opts},res=>{let b="";res.on("data",d=>b+=d);res.on("end",()=>r({s:res.statusCode,anth:!!res.headers["request-id"]||/"type":"error"/.test(b),ex:/Example Domain/i.test(b)}))});q.on("error",e=>r({s:"error",anth:false,ex:false}));q.on("timeout",()=>q.destroy());q.end()});
(async()=>{
  const a=await ask({path:"/",headers:{Host:"example.com"}});
  const b=await ask({path:"http://example.com/",headers:{Host:"example.com"}});
  const c=await new Promise(r=>{const s=net.connect(8443,"gateway",()=>s.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"));let d="";s.on("data",x=>{d+=x;s.end()});s.on("close",()=>r(d.split("\r\n")[0]||"closed"));s.on("error",()=>r("refused"));setTimeout(()=>s.destroy(),10000)});
  const okA=!a.ex&&a.anth, okB=!b.ex&&b.anth, okC=!/ 200 /.test(c);
  console.log(JSON.stringify({hostHeader:a,absoluteUrl:b,connect:c}));
  process.exit(okA&&okB&&okC?0:1);
})();'
OUT=$($DC exec -T brain node -e "$OTHER" 2>&1)
if [ $? -eq 0 ]; then pass "other Host / absolute URL / CONNECT never reach another upstream ($OUT)"; else fail "the gateway may forward elsewhere: $OUT"; fi
echo "4. Networks"
PROJECT=planr-poc   # `name:` in docker-compose.yml
INTERNAL=$(docker network inspect "${PROJECT}_sandbox" --format '{{.Internal}}' 2>/dev/null)
if [ "$INTERNAL" = "true" ]; then pass "${PROJECT}_sandbox is internal (no route out)"; else fail "${PROJECT}_sandbox is not internal ($INTERNAL)"; fi
EDGE=$(docker network inspect "${PROJECT}_edge" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null)
case "$EDGE" in
  *gateway*) ;;
  *) fail "the gateway is not on ${PROJECT}_edge";;
esac
OTHERS=$(echo "$EDGE" | tr ' ' '\n' | grep -v gateway | grep -v '^$' || true)
if [ -z "$OTHERS" ]; then pass "only the gateway is on ${PROJECT}_edge"; else fail "also on the edge network: $OTHERS"; fi

echo "5. Host ports"
for s in pm mocks brain speech; do
  P=$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$($DC ps -q "$s")")
  if echo "$P" | grep -q '"HostPort"'; then fail "$s publishes a host port: $P"; else pass "$s publishes no host port"; fi
done
GP=$(docker inspect --format '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$($DC ps -q gateway)")
BAD=$(echo "$GP" | tr ' ' '\n' | grep -v '^$' | grep -v '^127\.0\.0\.1:' || true)
if [ -z "$BAD" ] && [ -n "$GP" ]; then pass "gateway ports bind to 127.0.0.1 only: $GP"; else fail "gateway ports not loopback-only: $GP"; fi
if command -v lsof >/dev/null 2>&1; then
  L=$(lsof -nP -iTCP:5180-5182 -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}' | sort -u | tr '\n' ' ')
  case "$L" in *'*:'*|*'0.0.0.0:'*) fail "something listens on all interfaces: $L";; *) pass "listening sockets on the host: ${L:-(lsof saw none; Docker Desktop proxies them)}";; esac
elif command -v ss >/dev/null 2>&1; then
  L=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':518[0-2]$' | sort -u | tr '\n' ' ')
  case "$L" in *'0.0.0.0:'*|*'*:'*|*'[::]:'*) fail "something listens on all interfaces: $L";; *) pass "listening sockets on the host: $L";; esac
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "Isolation check PASSED."; else echo "Isolation check FAILED (see the lines marked with a cross)."; fi
exit "$FAIL"
