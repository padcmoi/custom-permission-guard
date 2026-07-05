#!/usr/bin/env bash
# Runs the 4 custom-permission-guard POC apps and proves pass/fail via exit
# code + logs — no HTTP polling, no manual checking. mariadb is long-running
# and the 4 apps are one-shot, so this script brings the stack up detached,
# waits on each app container specifically (docker wait), then reports.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> building the library (dist/ must exist before the POC images build)"
npm run build

cd poc
echo "==> clean slate: removing any previous run's containers/volumes"
docker compose down -v --remove-orphans

echo "==> building + starting the stack (mariadb + 4 one-shot apps)"
docker compose up -d --build

APPS=(express-single express-multiple nest-single nest-multiple)
declare -A EXIT_CODES

for app in "${APPS[@]}"; do
  container="cpg-poc-${app}"
  echo "==> waiting for ${container} to finish"
  code=$(docker wait "${container}")
  EXIT_CODES[$app]="$code"
done

echo ""
echo "==================== logs ===================="
for app in "${APPS[@]}"; do
  echo ""
  echo "---- ${app} ----"
  docker compose logs --no-log-prefix "${app}"
done

echo ""
echo "==================== summary ===================="
overall=0
for app in "${APPS[@]}"; do
  code="${EXIT_CODES[$app]}"
  if [ "$code" = "0" ]; then
    echo "${app}: OK (exit 0)"
  else
    echo "${app}: FAILED (exit ${code})"
    overall=1
  fi
done

echo ""
if [ "$overall" = "0" ]; then
  echo "ALL 4 POCs PROVED THE LIBRARY WORKS."
else
  echo "AT LEAST ONE POC FAILED — the library is NOT proven. See logs above."
fi

# Containers are left stopped (not removed) so `docker compose logs`/`docker
# inspect` remain queryable after this script exits.
exit "$overall"
