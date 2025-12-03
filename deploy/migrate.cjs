// Non-interactive database migration script for production
const { Pool } = require('pg');

async function runMigrations() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    try {
        console.log('[Migration] Starting database migrations...');
        
        // Check which tables exist
        const tablesResult = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        const existingTables = tablesResult.rows.map(r => r.table_name);
        console.log('[Migration] Existing tables:', existingTables.join(', ') || 'none');
        
        // Create tables that DON'T exist (without foreign keys first)
        const tablesToCreate = [];
        
        if (!existingTables.includes('market_data')) {
            tablesToCreate.push(`
                CREATE TABLE market_data (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    volume INTEGER NOT NULL,
                    interval VARCHAR(10) NOT NULL DEFAULT '1min'
                )
            `);
        }
        
        if (!existingTables.includes('predictions')) {
            tablesToCreate.push(`
                CREATE TABLE predictions (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    prediction_timestamp TIMESTAMP NOT NULL,
                    target_timestamp TIMESTAMP NOT NULL,
                    predicted_price REAL NOT NULL,
                    predicted_direction VARCHAR(10) NOT NULL,
                    model_type VARCHAR(50) NOT NULL DEFAULT 'moving_average',
                    confidence REAL,
                    timeframe VARCHAR(10) NOT NULL DEFAULT '1min'
                )
            `);
        }
        
        if (!existingTables.includes('system_status')) {
            tablesToCreate.push(`
                CREATE TABLE system_status (
                    id SERIAL PRIMARY KEY,
                    component VARCHAR(50) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'unknown',
                    last_check TIMESTAMP NOT NULL DEFAULT NOW(),
                    message TEXT,
                    metadata JSONB
                )
            `);
        }
        
        if (!existingTables.includes('price_state')) {
            tablesToCreate.push(`
                CREATE TABLE price_state (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL UNIQUE,
                    last_open REAL NOT NULL,
                    last_close REAL NOT NULL,
                    last_timestamp TIMESTAMP NOT NULL
                )
            `);
        }
        
        if (!existingTables.includes('users')) {
            tablesToCreate.push(`
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'user',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `);
        }
        
        if (!existingTables.includes('demo_accounts')) {
            tablesToCreate.push(`
                CREATE TABLE demo_accounts (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    balance REAL NOT NULL DEFAULT 100000,
                    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `);
        }
        
        if (!existingTables.includes('demo_trades')) {
            tablesToCreate.push(`
                CREATE TABLE demo_trades (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    type VARCHAR(10) NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price REAL,
                    quantity REAL NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'open',
                    profit_loss REAL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    closed_at TIMESTAMP
                )
            `);
        }
        
        if (!existingTables.includes('demo_positions')) {
            tablesToCreate.push(`
                CREATE TABLE demo_positions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
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
                )
            `);
        }
        
        if (!existingTables.includes('auto_trade_settings')) {
            tablesToCreate.push(`
                CREATE TABLE auto_trade_settings (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR NOT NULL UNIQUE,
                    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                    trade_units REAL NOT NULL DEFAULT 0.01,
                    symbol VARCHAR(20) NOT NULL DEFAULT 'XAUUSD',
                    last_trade_at TIMESTAMP,
                    last_decision VARCHAR(10),
                    total_auto_trades INTEGER DEFAULT 0,
                    closed_auto_trades INTEGER DEFAULT 0,
                    total_auto_profit REAL DEFAULT 0,
                    total_auto_loss REAL DEFAULT 0,
                    winning_auto_trades INTEGER DEFAULT 0,
                    losing_auto_trades INTEGER DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `);
        }
        
        if (!existingTables.includes('app_settings')) {
            tablesToCreate.push(`
                CREATE TABLE app_settings (
                    id SERIAL PRIMARY KEY,
                    key VARCHAR(100) NOT NULL UNIQUE,
                    value TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `);
        }
        
        if (!existingTables.includes('accuracy_results')) {
            tablesToCreate.push(`
                CREATE TABLE accuracy_results (
                    id SERIAL PRIMARY KEY,
                    prediction_id INTEGER NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    predicted_price REAL NOT NULL,
                    actual_price REAL NOT NULL,
                    price_difference REAL NOT NULL,
                    percentage_difference REAL NOT NULL,
                    is_match BOOLEAN NOT NULL,
                    match_threshold REAL NOT NULL DEFAULT 0.5
                )
            `);
        }
        
        if (!existingTables.includes('session')) {
            tablesToCreate.push(`
                CREATE TABLE session (
                    sid VARCHAR NOT NULL PRIMARY KEY,
                    sess JSON NOT NULL,
                    expire TIMESTAMP(6) NOT NULL
                )
            `);
        }
        
        // Execute table creation
        for (const sql of tablesToCreate) {
            try {
                await pool.query(sql);
                console.log('[Migration] Created table');
            } catch (err) {
                console.log('[Migration] Table creation note:', err.message.split('\n')[0]);
            }
        }
        
        // Create indexes (safe - IF NOT EXISTS)
        const indexes = [
            'CREATE INDEX IF NOT EXISTS market_data_symbol_timestamp_idx ON market_data(symbol, timestamp)',
            'CREATE INDEX IF NOT EXISTS market_data_timestamp_idx ON market_data(timestamp)',
            'CREATE INDEX IF NOT EXISTS predictions_symbol_target_idx ON predictions(symbol, target_timestamp)',
            'CREATE INDEX IF NOT EXISTS predictions_timeframe_idx ON predictions(timeframe)',
            'CREATE INDEX IF NOT EXISTS accuracy_results_symbol_idx ON accuracy_results(symbol)',
            'CREATE INDEX IF NOT EXISTS accuracy_results_timestamp_idx ON accuracy_results(timestamp)',
            'CREATE UNIQUE INDEX IF NOT EXISTS system_status_component_idx ON system_status(component)',
            'CREATE UNIQUE INDEX IF NOT EXISTS demo_accounts_user_id_idx ON demo_accounts(user_id)',
            'CREATE INDEX IF NOT EXISTS demo_trades_user_id_idx ON demo_trades(user_id)',
            'CREATE INDEX IF NOT EXISTS demo_trades_status_idx ON demo_trades(status)',
            'CREATE INDEX IF NOT EXISTS demo_positions_user_id_idx ON demo_positions(user_id)',
            'CREATE INDEX IF NOT EXISTS demo_positions_status_idx ON demo_positions(status)',
            'CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire)',
        ];
        
        for (const sql of indexes) {
            try {
                await pool.query(sql);
            } catch (err) {
                // Ignore index errors
            }
        }
        console.log('[Migration] Indexes ready');
        
        // Fix user_id column type in auto_trade_settings (critical!)
        // The old schema had INTEGER, but new schema uses VARCHAR (UUID)
        console.log('[Migration] Checking auto_trade_settings.user_id column type...');
        try {
            const colCheck = await pool.query(`
                SELECT data_type FROM information_schema.columns 
                WHERE table_name = 'auto_trade_settings' AND column_name = 'user_id'
            `);
            if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
                console.log('[Migration] Fixing user_id column: INTEGER -> VARCHAR');
                // Drop and recreate the table since column type change is complex
                await pool.query('DROP TABLE IF EXISTS auto_trade_settings CASCADE');
                await pool.query(`
                    CREATE TABLE auto_trade_settings (
                        id SERIAL PRIMARY KEY,
                        user_id VARCHAR NOT NULL UNIQUE,
                        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                        trade_units REAL NOT NULL DEFAULT 0.01,
                        symbol VARCHAR(20) NOT NULL DEFAULT 'XAUUSD',
                        last_trade_at TIMESTAMP,
                        last_decision VARCHAR(10),
                        total_auto_trades INTEGER DEFAULT 0,
                        closed_auto_trades INTEGER DEFAULT 0,
                        total_auto_profit REAL DEFAULT 0,
                        total_auto_loss REAL DEFAULT 0,
                        winning_auto_trades INTEGER DEFAULT 0,
                        losing_auto_trades INTEGER DEFAULT 0,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                `);
                console.log('[Migration] Recreated auto_trade_settings with VARCHAR user_id');
            }
        } catch (err) {
            console.log('[Migration] user_id check skipped:', err.message.split('\n')[0]);
        }
        
        // ADD COLUMNS to existing tables (the key fix!)
        console.log('[Migration] Adding new columns to existing tables...');
        
        const alterStatements = [
            // demo_positions columns
            'ALTER TABLE demo_positions ADD COLUMN IF NOT EXISTS is_auto_trade BOOLEAN DEFAULT FALSE',
            'ALTER TABLE demo_positions ADD COLUMN IF NOT EXISTS stop_loss REAL',
            'ALTER TABLE demo_positions ADD COLUMN IF NOT EXISTS take_profit REAL',
            
            // auto_trade_settings columns - CRITICAL: add symbol column
            "ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS symbol VARCHAR(20) DEFAULT 'XAUUSD'",
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMP',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS last_decision VARCHAR(10)',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS total_auto_trades INTEGER DEFAULT 0',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS closed_auto_trades INTEGER DEFAULT 0',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS total_auto_profit REAL DEFAULT 0',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS total_auto_loss REAL DEFAULT 0',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS winning_auto_trades INTEGER DEFAULT 0',
            'ALTER TABLE auto_trade_settings ADD COLUMN IF NOT EXISTS losing_auto_trades INTEGER DEFAULT 0',
            
            // demo_accounts columns
            "ALTER TABLE demo_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD'",
        ];
        
        for (const stmt of alterStatements) {
            try {
                await pool.query(stmt);
                console.log('[Migration] Applied:', stmt.substring(0, 70) + '...');
            } catch (err) {
                if (!err.message.includes('already exists')) {
                    console.log('[Migration] Skipped:', err.message.split('\n')[0]);
                }
            }
        }
        
        // Seed superadmin user
        console.log('[Migration] Checking superadmin user...');
        const existingAdmin = await pool.query("SELECT * FROM users WHERE username = 'adhielesmana'");
        
        if (existingAdmin.rows.length === 0) {
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
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
        console.error('[Migration] FATAL ERROR:', err.message);
        console.error(err.stack);
        await pool.end();
        process.exit(1);
    }
}

runMigrations();
