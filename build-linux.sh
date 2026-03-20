#!/usr/bin/env bash
set -e

echo "=== MediaForge — Linux Build (AppImage) ==="
echo "This bundles the app as an AppImage. Python + AI deps are auto-installed on first launch."
echo "Build size will be ~100 MB."
echo ""

# Check prerequisites
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found. Install from https://nodejs.org/"
  exit 1
fi

npm run build:linux
echo ""
echo "=== Build complete! Check dist/ for the AppImage. ==="
