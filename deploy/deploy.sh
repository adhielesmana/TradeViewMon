#!/bin/bash

set -e

APP_NAME="tradeviewmon"
DEFAULT_PORT=5000
DOMAIN=""
EMAIL=""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -d, --domain DOMAIN     Domain name for the application (required for SSL)"
    echo "  -e, --email EMAIL       Email for Let's Encrypt SSL certificate"
    echo "  -p, --port PORT         Preferred port (default: 5000, auto-adjusted if in use)"
    echo "  -k, --finnhub-key KEY   Finnhub API key (optional)"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Example:"
    echo "  $0 --domain tradeview.example.com --email admin@example.com"
    echo "  $0 --domain tradeview.example.com --email admin@example.com --finnhub-key YOUR_KEY"
}

FINNHUB_KEY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain) DOMAIN="$2"; shift 2 ;;
        -e|--email) EMAIL="$2"; shift 2 ;;
        -p|--port) DEFAULT_PORT="$2"; shift 2 ;;
        -k|--finnhub-key) FINNHUB_KEY="$2"; shift 2 ;;
        -h|--help) show_usage; exit 0 ;;
        *) log_error "Unknown option: $1"; show_usage; exit 1 ;;
    esac
done

find_available_port() {
    local port=$1
    local max_attempts=10
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if ! ss -tuln 2>/dev/null | grep -q ":$port " && \
           ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$port->"; then
            echo $port
            return 0
        fi
        echo -e "${YELLOW}[WARN]${NC} Port $port is in use, trying next port..." >&2
        port=$((port + 1))
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}[ERROR]${NC} Could not find available port after $max_attempts attempts" >&2
    exit 1
}

check_docker() {
    if command -v docker &> /dev/null && docker info &> /dev/null; then
        log_info "Docker is available"
        return 0
    else
        log_error "Docker is not available or not running"
        return 1
    fi
}

log_info "=========================================="
log_info "  TradeViewMon Deployment Script"
log_info "=========================================="
echo ""

# Check Docker first
if ! check_docker; then
    log_error "Please install Docker and ensure the Docker daemon is running"
    log_info "Install Docker: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Auto-generate environment file if it doesn't exist
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating environment configuration..."
    
    POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
    SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)
    
    cat > $ENV_FILE << EOF
# TradeViewMon Production Environment
# Auto-generated on $(date)

# Database Configuration
POSTGRES_USER=tradeviewmon
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=tradeviewmon

# Security
SESSION_SECRET=$SESSION_SECRET

# API Keys (optional - can be configured via Settings page)
FINNHUB_API_KEY=${FINNHUB_KEY}

# Application Port
APP_PORT=$DEFAULT_PORT
EOF
    
    chmod 600 $ENV_FILE
    log_info "Environment file created with auto-generated credentials"
else
    log_info "Using existing environment file"
    # Update FINNHUB_API_KEY if provided via command line
    if [ -n "$FINNHUB_KEY" ]; then
        if grep -q "^FINNHUB_API_KEY=" $ENV_FILE; then
            sed -i "s/^FINNHUB_API_KEY=.*/FINNHUB_API_KEY=$FINNHUB_KEY/" $ENV_FILE
        else
            echo "FINNHUB_API_KEY=$FINNHUB_KEY" >> $ENV_FILE
        fi
        log_info "Updated Finnhub API key"
    fi
fi

# Source the environment file
set -a
source $ENV_FILE
set +a

# Find available port
log_info "Checking port availability..."
APP_PORT=$(find_available_port $DEFAULT_PORT)
log_info "Application will use port: $APP_PORT"

# Update port in env file
if grep -q "^APP_PORT=" $ENV_FILE; then
    sed -i "s/^APP_PORT=.*/APP_PORT=$APP_PORT/" $ENV_FILE
else
    echo "APP_PORT=$APP_PORT" >> $ENV_FILE
fi

# Export APP_PORT for docker-compose
export APP_PORT

log_info "Stopping existing containers..."
docker compose -f deploy/docker-compose.yml down 2>/dev/null || \
docker-compose -f deploy/docker-compose.yml down 2>/dev/null || true

log_info "Building and starting services..."
docker compose -f deploy/docker-compose.yml up -d --build 2>/dev/null || \
docker-compose -f deploy/docker-compose.yml up -d --build

# Wait for services to be healthy
log_info "Waiting for services to start..."
echo -n "  Database: "
for i in {1..30}; do
    if docker exec tradeviewmon-db pg_isready -U tradeviewmon &>/dev/null; then
        echo -e "${GREEN}Ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Failed${NC}"
        log_error "Database failed to start. Check logs: docker logs tradeviewmon-db"
        exit 1
    fi
    echo -n "."
    sleep 1
done

echo -n "  Application: "
sleep 5
for i in {1..30}; do
    if curl -s http://127.0.0.1:$APP_PORT/api/system/status &>/dev/null; then
        echo -e "${GREEN}Ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${YELLOW}Starting (may need more time)${NC}"
    fi
    echo -n "."
    sleep 2
done

# Configure Nginx if domain is provided
if [ -n "$DOMAIN" ]; then
    if command -v nginx &> /dev/null; then
        log_info "Configuring Nginx for $DOMAIN..."
        
        NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
        
        cat > /tmp/tradeviewmon-nginx.conf << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location /ws {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
EOF
        
        if [ -w /etc/nginx/sites-available ]; then
            mv /tmp/tradeviewmon-nginx.conf $NGINX_CONF
            ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
            rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
            nginx -t && systemctl reload nginx
            log_info "Nginx configured successfully"
            
            if [ -n "$EMAIL" ] && command -v certbot &> /dev/null; then
                log_info "Obtaining SSL certificate..."
                certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect
                log_info "SSL certificate installed!"
            fi
        else
            log_warn "Cannot write to /etc/nginx. Run as root or copy config manually:"
            log_warn "  cat /tmp/tradeviewmon-nginx.conf"
        fi
    else
        log_warn "Nginx not installed. Application available on port $APP_PORT"
    fi
fi

echo ""
log_info "=========================================="
log_info "  Deployment Complete!"
log_info "=========================================="
echo ""

log_info "Container Status:"
docker ps --filter "name=tradeviewmon" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

log_info "Application running on port: $APP_PORT"
if [ -n "$DOMAIN" ]; then
    log_info "Access your app at: http://$DOMAIN"
else
    log_info "Access your app at: http://YOUR_SERVER_IP:$APP_PORT"
fi
echo ""

log_info "Default login: adhielesmana / admin123"
echo ""

log_info "Useful commands:"
log_info "  View app logs:    docker logs -f tradeviewmon"
log_info "  View db logs:     docker logs -f tradeviewmon-db"
log_info "  Restart all:      docker compose -f deploy/docker-compose.yml restart"
log_info "  Stop all:         docker compose -f deploy/docker-compose.yml down"
log_info "  Update & redeploy: git pull && ./deploy/deploy.sh"
echo ""

if [ -z "$FINNHUB_KEY" ] && [ -z "$FINNHUB_API_KEY" ]; then
    log_warn "Note: Finnhub API key not set. You can add it via:"
    log_warn "  1. Settings page in the app (recommended)"
    log_warn "  2. Edit .env file and redeploy"
fi
