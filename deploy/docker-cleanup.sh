#!/bin/bash
#
# Docker Cleanup Script
# Removes unused Docker images older than 7 days
# Run via systemd timer or cron: 0 3 * * * /path/to/docker-cleanup.sh
#

set -e

LOG_FILE="/var/log/docker-cleanup.log"
DAYS_OLD=1  # Delete images older than 24 hours

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Docker Cleanup Started ==="

# Remove dangling images (untagged images not used by any container)
log "Removing dangling images..."
DANGLING_COUNT=$(docker images -f "dangling=true" -q | wc -l)
if [ "$DANGLING_COUNT" -gt 0 ]; then
    docker image prune -f >> "$LOG_FILE" 2>&1
    log "Removed $DANGLING_COUNT dangling images"
else
    log "No dangling images found"
fi

# Remove unused images older than 7 days
log "Removing unused images older than ${DAYS_OLD} days..."
HOURS=$((DAYS_OLD * 24))
PRUNED=$(docker image prune -a -f --filter "until=${HOURS}h" 2>&1)
log "$PRUNED"

# Remove unused build cache older than 7 days
log "Removing unused build cache older than ${DAYS_OLD} days..."
BUILD_CACHE=$(docker builder prune -f --filter "until=${HOURS}h" 2>&1 || echo "No build cache to remove")
log "$BUILD_CACHE"

# Remove stopped containers older than 7 days (optional - commented by default)
# log "Removing stopped containers older than ${DAYS_OLD} days..."
# docker container prune -f --filter "until=${HOURS}h" >> "$LOG_FILE" 2>&1

# Remove unused volumes (be careful - this removes data!)
# Uncomment only if you want to clean volumes too
# log "Removing unused volumes..."
# docker volume prune -f >> "$LOG_FILE" 2>&1

# Compress old log files (older than 1 day, not already compressed)
log "Compressing old log files..."
find /var/log -name "*.log" -mtime +1 -type f ! -name "*.gz" 2>/dev/null | while read logfile; do
    if [ -f "$logfile" ] && [ -s "$logfile" ]; then
        gzip -9 "$logfile" 2>/dev/null && log "Compressed: $logfile"
    fi
done
log "Log compression completed"

# Compress application logs in container if accessible
log "Compressing application logs..."
docker exec trady-app find /app/logs -name "*.log" -mtime +1 -type f ! -name "*.gz" -exec gzip -9 {} \; 2>/dev/null || log "No app logs to compress"

# PostgreSQL maintenance - VACUUM and ANALYZE to reclaim space
log "Running PostgreSQL maintenance (VACUUM ANALYZE)..."
docker exec trady-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "VACUUM ANALYZE;" 2>/dev/null && log "Database VACUUM completed" || log "Database VACUUM skipped (container not running or not accessible)"

# Remove old PostgreSQL WAL files if pg_archivecleanup is available
log "Cleaning old PostgreSQL WAL files..."
docker exec trady-db pg_archivecleanup /var/lib/postgresql/data/pg_wal 2>/dev/null || log "WAL cleanup skipped"

# Show disk usage after cleanup
log "Current Docker disk usage:"
docker system df >> "$LOG_FILE" 2>&1

# Show system disk usage
log "System disk usage:"
df -h / >> "$LOG_FILE" 2>&1

log "=== Docker Cleanup Completed ==="

# Keep log file manageable (last 1000 lines)
if [ -f "$LOG_FILE" ]; then
    tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
