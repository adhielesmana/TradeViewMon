#!/bin/bash

set -e

APP_NAME="tradeviewmon"
DEFAULT_PORT=5000
DOMAIN=""
EMAIL=""
INSTALL_DIR="/opt/$APP_NAME"

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
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Example:"
    echo "  $0 --domain tradeview.example.com --email admin@example.com"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain) DOMAIN="$2"; shift 2 ;;
        -e|--email) EMAIL="$2"; shift 2 ;;
        -p|--port) DEFAULT_PORT="$2"; shift 2 ;;
        -h|--help) show_usage; exit 0 ;;
        *) log_error "Unknown option: $1"; show_usage; exit 1 ;;
    esac
done

find_available_port() {
    local port=$1
    local max_attempts=10
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if ! ss -tuln | grep -q ":$port "; then
            if ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$port->"; then
                echo $port
                return 0
            fi
        fi
        log_warn "Port $port is in use, trying next port..."
        port=$((port + 1))
        attempt=$((attempt + 1))
    done
    
    log_error "Could not find available port after $max_attempts attempts"
    exit 1
}

check_nginx() {
    if command -v nginx &> /dev/null; then
        log_info "Nginx is already installed"
        return 0
    else
        log_info "Nginx is not installed"
        return 1
    fi
}

install_nginx() {
    log_info "Installing Nginx..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y nginx
    elif command -v yum &> /dev/null; then
        sudo yum install -y nginx
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nginx
    else
        log_error "Could not detect package manager. Please install Nginx manually."
        exit 1
    fi
}

check_docker() {
    if command -v docker &> /dev/null; then
        log_info "Docker is already installed"
        return 0
    else
        log_info "Docker is not installed"
        return 1
    fi
}

install_docker() {
    log_info "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    log_info "Docker installed. You may need to log out and back in for group changes to take effect."
}

check_certbot() {
    if command -v certbot &> /dev/null; then
        log_info "Certbot is already installed"
        return 0
    else
        log_info "Certbot is not installed"
        return 1
    fi
}

install_certbot() {
    log_info "Installing Certbot..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y certbot python3-certbot-nginx
    elif command -v yum &> /dev/null; then
        sudo yum install -y certbot python3-certbot-nginx
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y certbot python3-certbot-nginx
    fi
}

log_info "=========================================="
log_info "  TradeViewMon Deployment Script"
log_info "=========================================="

log_info "Checking for port availability..."
APP_PORT=$(find_available_port $DEFAULT_PORT)
log_info "Application will use port: $APP_PORT"

if ! check_docker; then
    install_docker
fi

if ! check_nginx; then
    install_nginx
fi

if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
    if ! check_certbot; then
        install_certbot
    fi
fi

log_info "Creating application directory..."
sudo mkdir -p $INSTALL_DIR
sudo chown $USER:$USER $INSTALL_DIR

log_info "Copying application files..."
cp -r . $INSTALL_DIR/
cd $INSTALL_DIR

log_info "Creating environment file..."
cat > .env.production << EOF
NODE_ENV=production
PORT=$APP_PORT
DATABASE_URL=\${DATABASE_URL}
SESSION_SECRET=\${SESSION_SECRET}
FINNHUB_API_KEY=\${FINNHUB_API_KEY}
EOF

log_info "Building Docker image..."
docker build -t $APP_NAME:latest .

log_info "Stopping existing container if running..."
docker stop $APP_NAME 2>/dev/null || true
docker rm $APP_NAME 2>/dev/null || true

log_info "Starting application container..."
docker run -d \
    --name $APP_NAME \
    --restart unless-stopped \
    -p 127.0.0.1:$APP_PORT:5000 \
    --env-file .env.production \
    $APP_NAME:latest

log_info "Creating Nginx configuration..."
if [ -n "$DOMAIN" ]; then
    NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
    
    sudo tee $NGINX_CONF > /dev/null << EOF
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

    sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    
    sudo nginx -t
    sudo systemctl reload nginx
    
    if [ -n "$EMAIL" ]; then
        log_info "Obtaining SSL certificate..."
        sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect
        log_info "SSL certificate installed successfully!"
    else
        log_warn "No email provided. Skipping SSL setup."
        log_warn "Run 'sudo certbot --nginx -d $DOMAIN' manually to enable SSL."
    fi
else
    NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
    
    sudo tee $NGINX_CONF > /dev/null << EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

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

    sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    
    sudo nginx -t
    sudo systemctl reload nginx
    
    log_warn "No domain specified. Application accessible via server IP."
    log_warn "To enable SSL, run: $0 --domain your-domain.com --email your@email.com"
fi

echo ""
log_info "=========================================="
log_info "  Deployment Complete!"
log_info "=========================================="
echo ""
log_info "Application Status:"
docker ps --filter name=$APP_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
log_info "Application running on port: $APP_PORT"
if [ -n "$DOMAIN" ]; then
    if [ -n "$EMAIL" ]; then
        log_info "Access your app at: https://$DOMAIN"
    else
        log_info "Access your app at: http://$DOMAIN"
    fi
else
    log_info "Access your app at: http://YOUR_SERVER_IP"
fi
echo ""
log_info "Useful commands:"
log_info "  View logs:     docker logs -f $APP_NAME"
log_info "  Restart app:   docker restart $APP_NAME"
log_info "  Stop app:      docker stop $APP_NAME"
log_info "  Update app:    cd $INSTALL_DIR && git pull && ./deploy/deploy.sh"
