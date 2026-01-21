#!/bin/bash
#
# Install Docker Cleanup Timer
# Run with sudo if needed: sudo ./install-cleanup-timer.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/docker-cleanup.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [ ! -f "$CLEANUP_SCRIPT" ]; then
    log_error "Cleanup script not found: $CLEANUP_SCRIPT"
    exit 1
fi

chmod +x "$CLEANUP_SCRIPT"

if command -v systemctl &> /dev/null && [ -d "/etc/systemd/system" ]; then
    log_info "Installing systemd timer..."
    
    # Create service file with correct path
    cat > /etc/systemd/system/docker-cleanup.service << EOF
[Unit]
Description=Docker Cleanup - Remove unused images older than 7 days
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=$CLEANUP_SCRIPT
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # Create timer file
    cat > /etc/systemd/system/docker-cleanup.timer << EOF
[Unit]
Description=Run Docker Cleanup daily at 3 AM

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

    systemctl daemon-reload
    systemctl enable docker-cleanup.timer
    systemctl start docker-cleanup.timer
    
    log_info "Docker cleanup timer installed successfully!"
    log_info ""
    log_info "Commands:"
    log_info "  Check status:   systemctl status docker-cleanup.timer"
    log_info "  View logs:      journalctl -u docker-cleanup.service"
    log_info "  Run manually:   systemctl start docker-cleanup.service"
    log_info "  Disable:        systemctl disable docker-cleanup.timer"
else
    log_info "Systemd not available, setting up cron job..."
    
    CRON_JOB="0 3 * * * $CLEANUP_SCRIPT"
    
    if crontab -l 2>/dev/null | grep -q "docker-cleanup.sh"; then
        log_info "Docker cleanup cron job already exists"
    else
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
        log_info "Docker cleanup cron job installed (runs daily at 3 AM)"
    fi
    
    log_info ""
    log_info "Commands:"
    log_info "  View cron:      crontab -l"
    log_info "  Run manually:   $CLEANUP_SCRIPT"
fi
