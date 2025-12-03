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

# Auto-generate secure passwords
POSTGRES_PASSWORD=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)

log_info "Generating secure credentials..."

read -p "Enter your FINNHUB_API_KEY (optional, press Enter to skip): " FINNHUB_API_KEY

# Database will be deployed via Docker, so use internal Docker network URL
DATABASE_URL="postgresql://tradeviewmon:${POSTGRES_PASSWORD}@tradeviewmon-db:5432/tradeviewmon"

cat > $ENV_FILE << EOF
NODE_ENV=production
PORT=5000

# Database (auto-deployed via Docker)
DATABASE_URL=$DATABASE_URL
POSTGRES_USER=tradeviewmon
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=tradeviewmon

# Security
SESSION_SECRET=$SESSION_SECRET

# API Keys (optional)
FINNHUB_API_KEY=$FINNHUB_API_KEY
EOF

chmod 600 $ENV_FILE

log_info "Environment file created: $ENV_FILE"
log_info ""
log_info "Database will be automatically deployed via Docker"
log_info "Generated credentials have been saved to $ENV_FILE"
log_info ""
log_info "Next steps:"
log_info "1. Run: ./deploy/deploy.sh --domain your-domain.com --email your@email.com"
