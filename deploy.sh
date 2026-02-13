#!/bin/bash
# deploy.sh — Safe deploy script for Frasier
# WHY: Prevents the "forgot npm install" class of failures.
# Always run this instead of manual git pull + pm2 restart.
#
# Usage: ./deploy.sh

set -e

echo "=== Frasier Deploy ==="

cd /root/frasier

echo "[1/4] Pulling latest code..."
git pull

echo "[2/4] Installing dependencies..."
npm install --production

echo "[3/4] Restarting all processes..."
pm2 restart all

echo "[4/4] Verifying..."
sleep 3
pm2 status

echo ""
echo "=== Deploy complete ==="
echo "Check: pm2 logs --lines 10"
