#!/bin/sh
# Summit setup for macOS and Linux. Run  ./setup.sh
set -e

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed, or not on your PATH."
  echo "  Install the LTS build from https://nodejs.org and run this again."
  echo
  exit 1
fi

exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/setup-cloudflare.mjs" "$@"
