#!/bin/sh
set -e

echo "[Startup] Trady Production Server"
echo "[Startup] Waiting for database connection..."

# Wait for PostgreSQL to be ready
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); }).catch(() => process.exit(1));
    " 2>/dev/null; then
        echo "[Startup] Database connection successful!"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "[Startup] Waiting for database... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "[Startup] ERROR: Could not connect to database after $MAX_RETRIES attempts"
    exit 1
fi

echo "[Startup] Running database migrations..."

# Run the separate migration script (avoids shell escaping issues)
node ./migrate.cjs

echo "[Startup] Database ready!"
echo "[Startup] Starting application server..."

exec node dist/index.cjs
