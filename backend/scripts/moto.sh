#!/usr/bin/env bash
# Start/stop a local moto DynamoDB emulator on http://127.0.0.1:5001.
# Only the test environment ever points at this endpoint; application code
# reads AWS_ENDPOINT_URL from the environment and never hardcodes it.
set -euo pipefail

PORT="${MOTO_PORT:-5001}"
CONTAINER="${MOTO_CONTAINER:-timesheet-moto}"
IMAGE="${MOTO_IMAGE:-motoserver/moto:5.0.18}"

wait_for_moto() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${PORT}/moto-api/" >/dev/null 2>&1; then
      echo "moto is ready on http://127.0.0.1:${PORT}"
      return 0
    fi
    sleep 1
  done
  echo "moto did not become healthy on port ${PORT}" >&2
  return 1
}

case "${1:-up}" in
  up)
    if command -v docker >/dev/null 2>&1; then
      docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
      docker run -d --name "${CONTAINER}" -p "127.0.0.1:${PORT}:5000" "${IMAGE}" >/dev/null
    elif command -v moto_server >/dev/null 2>&1; then
      moto_server -H 127.0.0.1 -p "${PORT}" >/tmp/moto.log 2>&1 &
      echo $! > /tmp/moto.pid
    else
      echo "neither docker nor moto_server is available (pip install 'moto[server]')" >&2
      exit 1
    fi
    wait_for_moto
    ;;
  down)
    if command -v docker >/dev/null 2>&1; then
      docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    fi
    if [ -f /tmp/moto.pid ]; then
      kill "$(cat /tmp/moto.pid)" >/dev/null 2>&1 || true
      rm -f /tmp/moto.pid
    fi
    echo "moto stopped"
    ;;
  *)
    echo "usage: $0 {up|down}" >&2
    exit 1
    ;;
esac
