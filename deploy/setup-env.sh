#!/bin/bash

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

ENV_FILE=".env.production"

log_info "Trady Environment Setup"
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
DATABASE_URL="postgresql://trady:${POSTGRES_PASSWORD}@trady-db:5432/trady"

cat > $ENV_FILE << EOF
NODE_ENV=production
PORT=5000

# Database (auto-deployed via Docker)
DATABASE_URL=$DATABASE_URL
POSTGRES_USER=trady
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=trady

# Security
SESSION_SECRET=$SESSION_SECRET

# API Keys
FINNHUB_API_KEY=

# OpenAI API Key - REQUIRED for AI features
# Set your OpenAI API key here for production deployment
# Priority: OPENAI_API_KEY env var > Database (Settings page) > Replit integration
OPENAI_API_KEY=
EOF

chmod 600 $ENV_FILE

log_info "Environment file created: $ENV_FILE"
log_info ""
log_info "Database will be automatically deployed via Docker"
log_info ""
log_warn "REQUIRED: Configure your OpenAI API key in .env.production:"
log_warn ""
log_warn "  OPENAI_API_KEY=sk-your-key-here"
log_warn "  Get key: https://platform.openai.com/api-keys"
log_warn ""
log_warn "OPTIONAL: Configure Finnhub API key for stock data:"
log_warn ""
log_warn "  FINNHUB_API_KEY=your-key"
log_warn "  Get free key: https://finnhub.io/"
log_warn ""
log_info "Ready to deploy! Run:"
log_info "  ./deploy/deploy.sh --domain your-domain.com --email your@email.com"
