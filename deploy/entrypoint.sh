#!/bin/sh
set -e

echo "[Startup] TradeViewMon Production Server"
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

echo "[Startup] Running database migrations (non-interactive)..."

# Run migrations directly using SQL - NO interactive drizzle-kit
node -e "
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    const runMigrations = async () => {
        try {
            console.log('[Migration] Creating/updating tables...');
            
            // Create all base tables if they don't exist
            await pool.query(\`
                CREATE TABLE IF NOT EXISTS market_data (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    volume INTEGER NOT NULL,
                    interval VARCHAR(10) NOT NULL DEFAULT '1min'
                );
                CREATE INDEX IF NOT EXISTS market_data_symbol_timestamp_idx ON market_data(symbol, timestamp);
                CREATE INDEX IF NOT EXISTS market_data_timestamp_idx ON market_data(timestamp);
                
                CREATE TABLE IF NOT EXISTS predictions (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    prediction_timestamp TIMESTAMP NOT NULL,
                    target_timestamp TIMESTAMP NOT NULL,
                    predicted_price REAL NOT NULL,
                    predicted_direction VARCHAR(10) NOT NULL,
                    model_type VARCHAR(50) NOT NULL DEFAULT 'moving_average',
                    confidence REAL,
                    timeframe VARCHAR(10) NOT NULL DEFAULT '1min'
                );
                CREATE INDEX IF NOT EXISTS predictions_symbol_target_idx ON predictions(symbol, target_timestamp);
                CREATE INDEX IF NOT EXISTS predictions_timeframe_idx ON predictions(timeframe);
                
                CREATE TABLE IF NOT EXISTS accuracy_results (
                    id SERIAL PRIMARY KEY,
                    prediction_id INTEGER NOT NULL REFERENCES predictions(id),
                    symbol VARCHAR(20) NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    predicted_price REAL NOT NULL,
                    actual_price REAL NOT NULL,
                    price_difference REAL NOT NULL,
                    percentage_difference REAL NOT NULL,
                    is_match BOOLEAN NOT NULL,
                    match_threshold REAL NOT NULL DEFAULT 0.5
                );
                CREATE INDEX IF NOT EXISTS accuracy_results_symbol_idx ON accuracy_results(symbol);
                CREATE INDEX IF NOT EXISTS accuracy_results_timestamp_idx ON accuracy_results(timestamp);
                
                CREATE TABLE IF NOT EXISTS system_status (
                    id SERIAL PRIMARY KEY,
                    component VARCHAR(50) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'unknown',
                    last_check TIMESTAMP NOT NULL DEFAULT NOW(),
                    message TEXT,
                    metadata JSONB
                );
                CREATE UNIQUE INDEX IF NOT EXISTS system_status_component_idx ON system_status(component);
                
                CREATE TABLE IF NOT EXISTS price_state (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL UNIQUE,
                    last_open REAL NOT NULL,
                    last_close REAL NOT NULL,
                    last_timestamp TIMESTAMP NOT NULL
                );
                
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'user',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS demo_accounts (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    balance REAL NOT NULL DEFAULT 100000,
                    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS demo_accounts_user_id_idx ON demo_accounts(user_id);
                
                CREATE TABLE IF NOT EXISTS demo_trades (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    symbol VARCHAR(20) NOT NULL,
                    type VARCHAR(10) NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price REAL,
                    quantity REAL NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'open',
                    profit_loss REAL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    closed_at TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS demo_trades_user_id_idx ON demo_trades(user_id);
                CREATE INDEX IF NOT EXISTS demo_trades_status_idx ON demo_trades(status);
                
                CREATE TABLE IF NOT EXISTS demo_positions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    symbol VARCHAR(20) NOT NULL,
                    type VARCHAR(10) NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price REAL,
                    quantity REAL NOT NULL,
                    stop_loss REAL,
                    take_profit REAL,
                    status VARCHAR(20) NOT NULL DEFAULT 'open',
                    profit_loss REAL,
                    is_auto_trade BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    closed_at TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS demo_positions_user_id_idx ON demo_positions(user_id);
                CREATE INDEX IF NOT EXISTS demo_positions_status_idx ON demo_positions(status);
                
                CREATE TABLE IF NOT EXISTS auto_trade_settings (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    trade_units REAL NOT NULL DEFAULT 0.01,
                    max_positions INTEGER NOT NULL DEFAULT 5,
                    symbols TEXT[] DEFAULT ARRAY['XAUUSD'],
                    stop_loss_percent REAL DEFAULT 2.0,
                    take_profit_percent REAL DEFAULT 3.0,
                    total_auto_trades INTEGER DEFAULT 0,
                    total_profit_loss REAL DEFAULT 0,
                    winning_trades INTEGER DEFAULT 0,
                    losing_trades INTEGER DEFAULT 0,
                    closed_auto_trades INTEGER DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS app_settings (
                    id SERIAL PRIMARY KEY,
                    key VARCHAR(100) NOT NULL UNIQUE,
                    value TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS session (
                    sid VARCHAR NOT NULL COLLATE \"default\" PRIMARY KEY,
                    sess JSON NOT NULL,
                    expire TIMESTAMP(6) NOT NULL
                );
                CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
            \`);
            console.log('[Migration] Base tables ready!');
            
            // Add new columns to existing tables (safe - uses IF NOT EXISTS)
            console.log('[Migration] Adding new columns to existing tables...');
            
            const alterStatements = [
                // demo_positions - add all new columns
                'ALTER TABLE demo_positions ADD COLUMN IF NOT EXISTS is_auto_trade BOOLEAN DEFAULT FALSE',
                'ALTER TABLE demo_positions ADD COLUMN IF NOT EXISTS stop_loss REAL',
                'ALTER TABLE demo_positions ADD COLUMN IF NOT EXISTS take_profit REAL',
                
                // auto_trade_settings - add all tracking columns
                'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS total_auto_trades INTEGER DEFAULT 0',
                'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS total_profit_loss REAL DEFAULT 0',
                'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS winning_trades INTEGER DEFAULT 0',
                'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS losing_trades INTEGER DEFAULT 0',
                'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS closed_auto_trades INTEGER DEFAULT 0',
                
                // demo_accounts - ensure currency column exists
                'ALTER TABLE demo_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT \\'USD\\'',
            ];
            
            for (const stmt of alterStatements) {
                try {
                    await pool.query(stmt);
                    console.log('[Migration] Applied:', stmt.substring(0, 60) + '...');
                } catch (err) {
                    // Only log if it's not a 'column already exists' type error
                    if (!err.message.includes('already exists')) {
                        console.log('[Migration] Skipped:', err.message.split('\\n')[0]);
                    }
                }
            }
            console.log('[Migration] Column updates complete!');
            
            // Seed superadmin user if not exists
            console.log('[Migration] Checking superadmin user...');
            const bcrypt = require('bcryptjs');
            const existingAdmin = await pool.query(\"SELECT * FROM users WHERE username = 'adhielesmana'\");
            
            if (existingAdmin.rows.length === 0) {
                const hashedPassword = await bcrypt.hash('admin123', 10);
                await pool.query(
                    'INSERT INTO users (username, password, role) VALUES (\$1, \$2, \$3)',
                    ['adhielesmana', hashedPassword, 'superadmin']
                );
                console.log('[Migration] Superadmin user created: adhielesmana');
            } else {
                console.log('[Migration] Superadmin user already exists');
            }
            
            await pool.end();
            console.log('[Migration] All migrations complete!');
            process.exit(0);
        } catch (err) {
            console.error('[Migration] ERROR:', err.message);
            await pool.end();
            process.exit(1);
        }
    };
    
    runMigrations();
"

echo "[Startup] Database ready!"
echo "[Startup] Starting application server..."

exec node dist/index.cjs
