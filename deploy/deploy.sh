#!/bin/bash

set -e

APP_NAME="trady"
DEFAULT_PORT=5000
DOMAIN=""
EMAIL=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_CONFIG="$PROJECT_DIR/.deploy-config"

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
    echo "  -d, --domain DOMAIN     Domain name for the application (enables HTTPS)"
    echo "  -e, --email EMAIL       Email for Let's Encrypt SSL certificate"
    echo "  -p, --port PORT         Preferred port (default: 5000, auto-adjusted if in use)"
    echo "  -k, --finnhub-key KEY   Finnhub API key (optional)"
    echo "  --no-pull               Skip git pull (use existing code)"
    echo "  --https                 Force HTTPS cookies (use if behind SSL proxy)"
    echo "  --no-https              Force HTTP-only cookies (default without domain)"
    echo "  --reconfigure-ssl       Force reconfigure Nginx and SSL (when domain/email change)"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                              # Quick redeploy (uses saved config)"
    echo "  $0 --domain tradeview.example.com --email admin@example.com  # First time with SSL"
    echo "  $0 --reconfigure-ssl                            # Force reconfigure Nginx/SSL"
    echo "  $0 --finnhub-key YOUR_KEY                       # With API key"
    echo ""
    echo "Note: Domain and email are saved to .deploy-config after first use."
    echo "      Subsequent deploys only need: ./deploy.sh"
}

FINNHUB_KEY=""
SKIP_PULL=false
FORCE_HTTPS=""
RECONFIGURE_SSL=false
DOMAIN_FROM_CLI=false
EMAIL_FROM_CLI=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain) DOMAIN="$2"; DOMAIN_FROM_CLI=true; shift 2 ;;
        -e|--email) EMAIL="$2"; EMAIL_FROM_CLI=true; shift 2 ;;
        -p|--port) DEFAULT_PORT="$2"; shift 2 ;;
        -k|--finnhub-key) FINNHUB_KEY="$2"; shift 2 ;;
        --no-pull) SKIP_PULL=true; shift ;;
        --https) FORCE_HTTPS="true"; shift ;;
        --no-https) FORCE_HTTPS="false"; shift ;;
        --reconfigure-ssl) RECONFIGURE_SSL=true; shift ;;
        -h|--help) show_usage; exit 0 ;;
        *) log_error "Unknown option: $1"; show_usage; exit 1 ;;
    esac
done

# Load saved config if exists (only if domain/email not provided via CLI)
if [ -f "$DEPLOY_CONFIG" ]; then
    log_info "Loading saved deployment config..."
    source "$DEPLOY_CONFIG"
    
    # CLI arguments override saved config
    if [ "$DOMAIN_FROM_CLI" = true ]; then
        SAVED_DOMAIN="$DOMAIN"
    elif [ -n "$SAVED_DOMAIN" ]; then
        DOMAIN="$SAVED_DOMAIN"
    fi
    
    if [ "$EMAIL_FROM_CLI" = true ]; then
        SAVED_EMAIL="$EMAIL"
    elif [ -n "$SAVED_EMAIL" ]; then
        EMAIL="$SAVED_EMAIL"
    fi
    
    log_info "Using domain: ${DOMAIN:-none}"
    log_info "Using email: ${EMAIL:-none}"
fi

# Determine if we need to configure/reconfigure SSL
NEEDS_SSL_CONFIG=false
if [ "$RECONFIGURE_SSL" = true ]; then
    NEEDS_SSL_CONFIG=true
    log_info "Force reconfiguring SSL (--reconfigure-ssl flag)"
elif [ "$DOMAIN_FROM_CLI" = true ] || [ "$EMAIL_FROM_CLI" = true ]; then
    # New domain/email provided via CLI - need to configure
    NEEDS_SSL_CONFIG=true
    log_info "New domain/email provided, will configure Nginx/SSL"
elif [ ! -f "$DEPLOY_CONFIG" ] && [ -n "$DOMAIN" ]; then
    # First time setup with domain
    NEEDS_SSL_CONFIG=true
    log_info "First time setup with domain, will configure Nginx/SSL"
fi

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
log_info "  Trady Deployment Script"
log_info "=========================================="
echo ""

# Change to project directory
cd "$PROJECT_DIR"
log_info "Working directory: $(pwd)"

# Check Docker first
if ! check_docker; then
    log_error "Please install Docker and ensure the Docker daemon is running"
    log_info "Install Docker: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# ============================================
# STEP 1: Shutdown existing Trady ONLY
# ============================================
log_info "Shutting down existing Trady instances..."

# IMPORTANT: We ONLY stop Trady containers, NOT other apps!
# Stop any existing Trady containers by name
log_info "Stopping Trady containers..."
docker compose -f deploy/docker-compose.yml down 2>/dev/null || true
docker stop trady 2>/dev/null || true
docker stop trady-db 2>/dev/null || true
docker rm -f trady 2>/dev/null || true
docker rm -f trady-db 2>/dev/null || true

# Clean up any containers with trady in the name (only Trady!)
docker ps -a --filter "name=trady" --format "{{.ID}}" 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true

log_info "Trady instances stopped (other apps untouched)"
echo ""

# Git pull to get latest code (unless skipped)
if [ "$SKIP_PULL" = false ] && [ -d ".git" ]; then
    log_info "Pulling latest code from repository..."
    
    # Stash any local changes
    if ! git diff --quiet 2>/dev/null; then
        log_warn "Local changes detected, stashing them..."
        git stash push -m "Auto-stash before deploy $(date)"
    fi
    
    git fetch --all 2>/dev/null || true
    git pull --ff-only 2>/dev/null || git reset --hard origin/$(git rev-parse --abbrev-ref HEAD) 2>/dev/null || true
    log_info "Code updated successfully"
else
    if [ "$SKIP_PULL" = true ]; then
        log_info "Skipping git pull (--no-pull flag)"
    else
        log_info "Not a git repository, using existing code"
    fi
fi

# Determine USE_HTTPS setting
if [ -n "$FORCE_HTTPS" ]; then
    USE_HTTPS="$FORCE_HTTPS"
elif [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
    # If domain and email provided, assume SSL will be configured
    USE_HTTPS="true"
else
    # Default to false for simple deployments
    USE_HTTPS="false"
fi

log_info "HTTPS cookies: $USE_HTTPS"

# Auto-generate environment file if it doesn't exist
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating environment configuration..."
    
    POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)
    SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)
    
    cat > $ENV_FILE << EOF
# Trady Production Environment
# Auto-generated on $(date)

# Database Configuration
POSTGRES_USER=trady
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=trady

# Security
SESSION_SECRET=$SESSION_SECRET

# API Keys (optional - can be configured via Settings page)
FINNHUB_API_KEY=${FINNHUB_KEY}

# Application Port
APP_PORT=$DEFAULT_PORT

# HTTPS Configuration (set to true if behind SSL/HTTPS proxy)
USE_HTTPS=$USE_HTTPS
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
    
    # Update USE_HTTPS
    if grep -q "^USE_HTTPS=" $ENV_FILE; then
        sed -i "s/^USE_HTTPS=.*/USE_HTTPS=$USE_HTTPS/" $ENV_FILE
    else
        echo "USE_HTTPS=$USE_HTTPS" >> $ENV_FILE
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

# Export variables for docker-compose
export APP_PORT
export USE_HTTPS

log_info "Cleaning up old Docker images (to ensure fresh build)..."
docker rmi -f trady:latest 2>/dev/null || true
docker builder prune -f 2>/dev/null || true

log_info "Building and starting services (with no cache)..."
docker compose -f deploy/docker-compose.yml build --no-cache
docker compose -f deploy/docker-compose.yml up -d

# Wait for services to be healthy
log_info "Waiting for services to start..."

# Get credentials from env file for healthcheck
DB_USER="${POSTGRES_USER:-trady}"
DB_NAME="${POSTGRES_DB:-trady}"

echo -n "  Database: "
for i in {1..30}; do
    if docker exec trady-db pg_isready -U "$DB_USER" -d "$DB_NAME" &>/dev/null; then
        echo -e "${GREEN}Ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Failed${NC}"
        log_error "Database failed to start. Check logs: docker logs trady-db"
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

# ============================================
# STEP: Initialize Database Schema
# ============================================
log_info "Initializing database schema..."

# Get database credentials from env file
DB_USER="${POSTGRES_USER:-trady}"
DB_NAME="${POSTGRES_DB:-trady}"

# First, run the comprehensive init script that creates all tables/columns if not exist
if [ -f "deploy/migrations/init_database.sql" ]; then
    log_info "Running database initialization script..."
    
    # Copy SQL file to container first (most reliable method)
    log_info "Copying migration file to database container..."
    docker cp deploy/migrations/init_database.sql trady-db:/tmp/init_database.sql
    
    # Execute the SQL file with verbose output using variables from env
    log_info "Executing SQL migration (user: $DB_USER, db: $DB_NAME)..."
    if docker exec trady-db psql -U "$DB_USER" -d "$DB_NAME" -f /tmp/init_database.sql; then
        log_info "Database migration executed successfully!"
    else
        log_error "Database migration failed!"
        log_info "Checking if this is a stale volume issue..."
        
        # Check which users exist in the database
        log_info "Listing existing database roles..."
        docker exec trady-db psql -U postgres -c "\\du" 2>/dev/null || true
        
        log_warn "If you see 'role does not exist' error, try removing the old volume:"
        log_warn "  docker compose -f deploy/docker-compose.yml down -v"
        log_warn "  ./deploy/deploy.sh"
        log_warn ""
        log_warn "Or if you have an existing database with different credentials,"
        log_warn "update the .env file with the correct POSTGRES_USER and POSTGRES_DB values."
    fi
    
    # Cleanup
    docker exec trady-db rm -f /tmp/init_database.sql 2>/dev/null || true
else
    log_error "Database init script not found at deploy/migrations/init_database.sql"
    log_error "Make sure you have pulled the latest code!"
    exit 1
fi

# Then try drizzle push for any remaining schema updates (non-interactive)
log_info "Checking for additional schema updates via Drizzle..."
docker exec trady sh -c "echo 'y' | npm run db:push 2>/dev/null" || log_warn "Drizzle push skipped (optional)"
log_info "Database schema initialization complete"

# Save deployment config for future runs
if [ -n "$DOMAIN" ] || [ -n "$EMAIL" ]; then
    log_info "Saving deployment config for future runs..."
    cat > "$DEPLOY_CONFIG" << EOF
# Trady Deployment Config (auto-generated)
# To reconfigure SSL, run: ./deploy.sh --reconfigure-ssl
SAVED_DOMAIN="$DOMAIN"
SAVED_EMAIL="$EMAIL"
EOF
    chmod 600 "$DEPLOY_CONFIG"
    log_info "Config saved to .deploy-config"
fi

# Configure Nginx only if needed (first time or --reconfigure-ssl)
if [ -n "$DOMAIN" ] && [ "$NEEDS_SSL_CONFIG" = true ]; then
    if command -v nginx &> /dev/null; then
        log_info "Configuring Nginx for $DOMAIN..."
        
        NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
        
        cat > /tmp/trady-nginx.conf << EOF
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
        
        if [ -w /etc/nginx/sites-available ] || [ "$(id -u)" = "0" ]; then
            cp /tmp/trady-nginx.conf $NGINX_CONF
            ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
            rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
            nginx -t && systemctl reload nginx
            log_info "Nginx configured successfully"
            
            if [ -n "$EMAIL" ] && command -v certbot &> /dev/null; then
                log_info "Obtaining SSL certificate..."
                certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect || {
                    log_warn "SSL certificate setup failed. You may need to run certbot manually."
                }
            fi
        else
            log_warn "Cannot write to /etc/nginx. Run with sudo or copy config manually:"
            log_warn "  sudo cp /tmp/trady-nginx.conf $NGINX_CONF"
            log_warn "  sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/"
            log_warn "  sudo nginx -t && sudo systemctl reload nginx"
        fi
    else
        log_warn "Nginx not installed. Application available on port $APP_PORT"
    fi
elif [ -n "$DOMAIN" ]; then
    log_info "Skipping Nginx/SSL config (already configured). Use --reconfigure-ssl to force."
fi

echo ""
log_info "=========================================="
log_info "  Deployment Complete!"
log_info "=========================================="
echo ""

log_info "Container Status:"
docker ps --filter "name=trady" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

log_info "Application running on port: $APP_PORT"
if [ -n "$DOMAIN" ]; then
    if [ "$USE_HTTPS" = "true" ]; then
        log_info "Access your app at: https://$DOMAIN"
    else
        log_info "Access your app at: http://$DOMAIN"
    fi
else
    log_info "Access your app at: http://YOUR_SERVER_IP:$APP_PORT"
fi
echo ""

log_info "Default login credentials:"
log_info "  Username: adhielesmana"
log_info "  Password: admin123"
echo ""

log_info "Useful commands:"
log_info "  View app logs:    docker logs -f trady"
log_info "  View db logs:     docker logs -f trady-db"
log_info "  Restart all:      docker compose -f deploy/docker-compose.yml restart"
log_info "  Stop all:         docker compose -f deploy/docker-compose.yml down"
log_info "  Redeploy:         ./deploy/deploy.sh"
echo ""

if [ -z "$FINNHUB_KEY" ] && [ -z "$FINNHUB_API_KEY" ]; then
    log_warn "Note: Finnhub API key not set. You can add it via:"
    log_warn "  1. Settings page in the app (recommended)"
    log_warn "  2. Redeploy with: ./deploy/deploy.sh --finnhub-key YOUR_KEY"
fi

# ============================================
# STEP: Setup Docker Cleanup Timer
# ============================================
setup_docker_cleanup() {
    log_info "Setting up automatic Docker cleanup..."
    
    CLEANUP_SCRIPT="$SCRIPT_DIR/docker-cleanup.sh"
    SERVICE_FILE="$SCRIPT_DIR/docker-cleanup.service"
    TIMER_FILE="$SCRIPT_DIR/docker-cleanup.timer"
    
    if [ ! -f "$CLEANUP_SCRIPT" ]; then
        log_warn "Docker cleanup script not found, skipping auto-cleanup setup"
        return
    fi
    
    # Make cleanup script executable
    chmod +x "$CLEANUP_SCRIPT"
    
    # Check if we have systemd
    if command -v systemctl &> /dev/null && [ -d "/etc/systemd/system" ]; then
        # Install systemd timer
        if [ -w /etc/systemd/system ] || [ "$(id -u)" = "0" ]; then
            log_info "Installing systemd timer for Docker cleanup..."
            
            # Update service file with correct path
            sed "s|/opt/trady/deploy/docker-cleanup.sh|$CLEANUP_SCRIPT|g" "$SERVICE_FILE" > /etc/systemd/system/docker-cleanup.service
            cp "$TIMER_FILE" /etc/systemd/system/docker-cleanup.timer
            
            # Enable and start timer
            systemctl daemon-reload
            systemctl enable docker-cleanup.timer
            systemctl start docker-cleanup.timer
            
            log_info "Docker cleanup timer installed (runs daily at 3 AM)"
            log_info "  Check status: systemctl status docker-cleanup.timer"
            log_info "  View logs:    journalctl -u docker-cleanup.service"
        else
            log_warn "Cannot install systemd timer (need root access)"
            log_warn "Install manually with: sudo $SCRIPT_DIR/install-cleanup-timer.sh"
        fi
    else
        # Fall back to cron
        log_info "Systemd not available, setting up cron job..."
        
        CRON_JOB="0 3 * * * $CLEANUP_SCRIPT"
        
        if crontab -l 2>/dev/null | grep -q "docker-cleanup.sh"; then
            log_info "Docker cleanup cron job already exists"
        else
            (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
            log_info "Docker cleanup cron job installed (runs daily at 3 AM)"
        fi
    fi
}

# Run cleanup timer setup
setup_docker_cleanup

# ============================================
# STEP: Timezone Configuration Info
# ============================================
log_info ""
log_info "Timezone Configuration:"
HOST_TZ=$(cat /etc/timezone 2>/dev/null || timedatectl show --property=Timezone --value 2>/dev/null || echo "UTC")
log_info "  Host timezone: $HOST_TZ"
log_info "  Containers sync with host via /etc/localtime mount"

# Add TZ to .env if not present
if ! grep -q "^TZ=" $ENV_FILE 2>/dev/null; then
    echo "" >> $ENV_FILE
    echo "# Timezone (synced with host)" >> $ENV_FILE
    echo "TZ=$HOST_TZ" >> $ENV_FILE
    log_info "  Added TZ=$HOST_TZ to .env file"
fi
