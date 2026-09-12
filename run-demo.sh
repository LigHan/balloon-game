#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export GAME_DEV_MODE=1
export GAME_DEV_SEED="championship-2026-demo"
exec bash run.sh
