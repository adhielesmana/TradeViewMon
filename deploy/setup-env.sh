#!/bin/bash

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

ENV_FILE=".env.production"

log_info "TradeViewMon Environment Setup"
log_info "================================"
echo ""

if [ -f "$ENV_FILE" ]; then
    log_warn "Existing $ENV_FILE found. Backing up to ${ENV_FILE}.backup"
    cp $ENV_FILE ${ENV_FILE}.backup
fi

read -p "Enter your PostgreSQL DATABASE_URL: " DATABASE_URL
read -p "Enter your SESSION_SECRET (press Enter to generate): " SESSION_SECRET
read -p "Enter your FINNHUB_API_KEY (optional, press Enter to skip): " FINNHUB_API_KEY

if [ -z "$SESSION_SECRET" ]; then
    SESSION_SECRET=$(openssl rand -hex 32)
    log_info "Generated SESSION_SECRET"
fi

cat > $ENV_FILE << EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=$DATABASE_URL
SESSION_SECRET=$SESSION_SECRET
FINNHUB_API_KEY=$FINNHUB_API_KEY
EOF

chmod 600 $ENV_FILE

log_info "Environment file created: $ENV_FILE"
log_info ""
log_info "Next steps:"
log_info "1. Review your .env.production file"
log_info "2. Run: ./deploy/deploy.sh --domain your-domain.com --email your@email.com"
