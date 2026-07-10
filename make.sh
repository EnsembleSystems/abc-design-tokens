#!/usr/bin/env bash
set -euo pipefail

CMD=${1:-help}

case "$CMD" in
  build)        npm run build ;;
  tokens)       npm run build:tokens ;;
  reset)        npm run build:reset ;;
  copy)         npm run copy ;;
  all)          npm run build && npm run copy ;;
  *)
    echo "Usage: ./make.sh <command>"
    echo ""
    echo "  build   — build tokens.css + reset.css"
    echo "  tokens  — build tokens.css only"
    echo "  reset   — build reset.css only"
    echo "  copy    — copy dist files to abc-aem-sites"
    echo "  all     — build then copy"
    ;;
esac
