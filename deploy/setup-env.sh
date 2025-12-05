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

# API Keys - Add your keys here
FINNHUB_API_KEY=

# OpenAI API Key for AI Trading Features
# Required for AI-enhanced auto-trading and market analysis
# Get your API key from: https://platform.openai.com/api-keys
AI_INTEGRATIONS_OPENAI_API_KEY=
EOF

chmod 600 $ENV_FILE

log_info "Environment file created: $ENV_FILE"
log_info ""
log_info "Database will be automatically deployed via Docker"
log_info ""
log_warn "IMPORTANT: Configure API keys in .env.production:"
log_warn ""
log_warn "  1. FINNHUB_API_KEY (optional) - For real-time stock data"
log_warn "     Get free key: https://finnhub.io/"
log_warn ""
log_warn "  2. AI_INTEGRATIONS_OPENAI_API_KEY (required for AI features)"
log_warn "     Required for AI-enhanced auto-trading"
log_warn "     Get your key: https://platform.openai.com/api-keys"
log_warn ""
log_warn "  Edit the file: nano .env.production"
log_info ""
log_info "Ready to deploy! Run:"
log_info "  ./deploy/deploy.sh --domain your-domain.com --email your@email.com"
