#!/bin/bash
# Fast rsync deployment — syncs only changed files, rebuilds on VM
# Usage: ./deploy/rsync-deploy.sh [--no-build] [--restart-only]

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

VM="trady-vm"
REMOTE_DIR="/root/TradeViewMon"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="deploy/.env.production"

NO_BUILD=false
RESTART_ONLY=false

for arg in "$@"; do
  case $arg in
    --no-build)    NO_BUILD=true ;;
    --restart-only) RESTART_ONLY=true ;;
  esac
done

# --- Restart-only mode ---
if $RESTART_ONLY; then
  log "Restarting containers..."
  ssh $VM "cd $REMOTE_DIR/deploy && docker compose --env-file .env.production -f docker-compose.yml restart"
  log "Done!"
  exit 0
fi

# --- Step 1: rsync code to VM ---
log "Syncing code to $VM (incremental, partial)..."

rsync -avz --partial --progress \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='*.tar.gz' \
  --exclude='.deploy-config' \
  --exclude='.claude' \
  --exclude='server/public' \
  --exclude='attached_assets' \
  --exclude='*.png' \
  --exclude='.env*' \
  -e "ssh -o StrictHostKeyChecking=no" \
  "$LOCAL_DIR/" "$VM:$REMOTE_DIR/"

log "Sync complete!"

if $NO_BUILD; then
  log "Skipping build (--no-build). Done!"
  exit 0
fi

# --- Step 2: Rebuild and restart on VM ---
log "Building and restarting on VM..."

ssh $VM "cd $REMOTE_DIR && \
  docker build -t deploy-app:latest -f deploy/Dockerfile . && \
  cd deploy && \
  docker compose --env-file .env.production -f docker-compose.yml up -d && \
  echo 'Waiting for health...' && \
  sleep 5 && \
  docker ps --format 'table {{.Names}}\t{{.Status}}'"

log "Deployment complete!"
