-- Trady Database Initialization
-- Creates all tables if they don't exist, adds missing columns to existing tables
-- Safe to run multiple times (idempotent)

-- ============================================
-- TABLE: market_data
-- ============================================
CREATE TABLE IF NOT EXISTS market_data (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    "timestamp" TIMESTAMP NOT NULL,
    "open" REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    "close" REAL NOT NULL,
    volume INTEGER NOT NULL,
    "interval" VARCHAR(10) NOT NULL DEFAULT '1min'
);

CREATE INDEX IF NOT EXISTS market_data_symbol_timestamp_idx ON market_data(symbol, "timestamp");
CREATE INDEX IF NOT EXISTS market_data_timestamp_idx ON market_data("timestamp");

-- ============================================
-- TABLE: predictions
-- ============================================
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

-- ============================================
-- TABLE: accuracy_results
-- ============================================
CREATE TABLE IF NOT EXISTS accuracy_results (
    id SERIAL PRIMARY KEY,
    prediction_id INTEGER NOT NULL REFERENCES predictions(id),
    symbol VARCHAR(20) NOT NULL,
    "timestamp" TIMESTAMP NOT NULL,
    predicted_price REAL NOT NULL,
    actual_price REAL NOT NULL,
    price_difference REAL NOT NULL,
    percentage_difference REAL NOT NULL,
    is_match BOOLEAN NOT NULL,
    match_threshold REAL NOT NULL DEFAULT 0.5
);

CREATE INDEX IF NOT EXISTS accuracy_results_symbol_idx ON accuracy_results(symbol);
CREATE INDEX IF NOT EXISTS accuracy_results_timestamp_idx ON accuracy_results("timestamp");

-- ============================================
-- TABLE: system_status
-- ============================================
CREATE TABLE IF NOT EXISTS system_status (
    id SERIAL PRIMARY KEY,
    component VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL,
    last_check TIMESTAMP NOT NULL,
    last_success TIMESTAMP,
    error_message TEXT,
    metadata TEXT
);

-- ============================================
-- TABLE: price_state
-- ============================================
CREATE TABLE IF NOT EXISTS price_state (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    last_open REAL NOT NULL,
    last_close REAL NOT NULL,
    last_timestamp TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- ============================================
-- TABLE: users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    display_name TEXT,
    password TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_login TIMESTAMP
);

-- ============================================
-- TABLE: user_invites
-- ============================================
CREATE TABLE IF NOT EXISTS user_invites (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    invited_by_id VARCHAR REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- TABLE: ai_suggestions
-- ============================================
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    generated_at TIMESTAMP NOT NULL,
    decision VARCHAR(10) NOT NULL,
    confidence REAL NOT NULL,
    buy_target REAL,
    sell_target REAL,
    current_price REAL NOT NULL,
    reasoning TEXT,
    indicators TEXT,
    is_evaluated BOOLEAN NOT NULL DEFAULT false,
    evaluated_at TIMESTAMP,
    actual_price REAL,
    was_accurate BOOLEAN,
    profit_loss REAL,
    entry_price REAL,
    stop_loss REAL,
    take_profit_1 REAL,
    take_profit_2 REAL,
    take_profit_3 REAL,
    risk_reward_ratio REAL,
    support_level REAL,
    resistance_level REAL,
    signal_type VARCHAR(20) DEFAULT 'immediate',
    valid_until TIMESTAMP,
    trade_plan TEXT
);

CREATE INDEX IF NOT EXISTS ai_suggestions_symbol_idx ON ai_suggestions(symbol);
CREATE INDEX IF NOT EXISTS ai_suggestions_generated_at_idx ON ai_suggestions(generated_at);
CREATE INDEX IF NOT EXISTS ai_suggestions_symbol_generated_idx ON ai_suggestions(symbol, generated_at);

-- ============================================
-- TABLE: symbol_categories
-- ============================================
CREATE TABLE IF NOT EXISTS symbol_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Seed default categories (ON CONFLICT prevents duplicates on re-run)
INSERT INTO symbol_categories (name, display_order, is_active) VALUES 
    ('Commodities', 100, true),
    ('Indonesian Stocks', 90, true),
    ('Indices', 80, true),
    ('Crypto', 70, true),
    ('Forex', 60, true),
    ('Bonds', 50, true),
    ('Stocks', 40, true),
    ('Precious Metals', 95, true),
    ('Mining Stocks', 85, true)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- TABLE: monitored_symbols
-- ============================================
CREATE TABLE IF NOT EXISTS monitored_symbols (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- TABLE: rss_feeds
-- ============================================
CREATE TABLE IF NOT EXISTS rss_feeds (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- TABLE: news_articles (7-day retention for AI learning)
-- ============================================
CREATE TABLE IF NOT EXISTS news_articles (
    id SERIAL PRIMARY KEY,
    feed_id INTEGER REFERENCES rss_feeds(id),
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    link_hash VARCHAR(64) NOT NULL UNIQUE,
    content TEXT,
    source VARCHAR(100),
    published_at TIMESTAMP,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sentiment VARCHAR(20),
    affected_symbols TEXT,
    ai_analysis TEXT
);

CREATE INDEX IF NOT EXISTS news_articles_feed_published_idx ON news_articles(feed_id, published_at);
CREATE INDEX IF NOT EXISTS news_articles_fetched_idx ON news_articles(fetched_at);
CREATE INDEX IF NOT EXISTS news_articles_published_idx ON news_articles(published_at);

-- ============================================
-- TABLE: news_analysis_snapshots (cached AI market predictions)
-- ============================================
CREATE TABLE IF NOT EXISTS news_analysis_snapshots (
    id SERIAL PRIMARY KEY,
    overall_sentiment VARCHAR(20) NOT NULL,
    confidence REAL NOT NULL,
    summary TEXT NOT NULL,
    key_factors TEXT,
    affected_symbols TEXT,
    trading_recommendation TEXT,
    risk_level VARCHAR(20),
    news_count INTEGER NOT NULL DEFAULT 0,
    analyzed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    source_articles TEXT,
    historical_context TEXT,
    analysis_type VARCHAR(50) DEFAULT 'regular',
    generated_article TEXT
);

CREATE INDEX IF NOT EXISTS news_analysis_snapshots_analyzed_idx ON news_analysis_snapshots(analyzed_at DESC);
CREATE INDEX IF NOT EXISTS news_analysis_snapshots_type_idx ON news_analysis_snapshots(analysis_type);

-- ============================================
-- TABLE: demo_accounts
-- ============================================
CREATE TABLE IF NOT EXISTS demo_accounts (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id),
    balance REAL NOT NULL DEFAULT 0,
    total_deposited REAL NOT NULL DEFAULT 0,
    total_withdrawn REAL NOT NULL DEFAULT 0,
    total_profit REAL NOT NULL DEFAULT 0,
    total_loss REAL NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_accounts_user_idx ON demo_accounts(user_id);

-- ============================================
-- TABLE: demo_positions
-- ============================================
CREATE TABLE IF NOT EXISTS demo_positions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES demo_accounts(id),
    user_id VARCHAR NOT NULL REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    type VARCHAR(10) NOT NULL,
    entry_price REAL NOT NULL,
    quantity REAL NOT NULL,
    current_price REAL,
    exit_price REAL,
    stop_loss REAL,
    take_profit REAL,
    profit_loss REAL DEFAULT 0,
    profit_loss_percent REAL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP,
    closed_reason VARCHAR(50),
    is_auto_trade BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS demo_positions_account_idx ON demo_positions(account_id);
CREATE INDEX IF NOT EXISTS demo_positions_user_idx ON demo_positions(user_id);
CREATE INDEX IF NOT EXISTS demo_positions_symbol_idx ON demo_positions(symbol);
CREATE INDEX IF NOT EXISTS demo_positions_status_idx ON demo_positions(status);
CREATE INDEX IF NOT EXISTS demo_positions_auto_trade_idx ON demo_positions(is_auto_trade);

-- ============================================
-- TABLE: demo_transactions
-- ============================================
CREATE TABLE IF NOT EXISTS demo_transactions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES demo_accounts(id),
    user_id VARCHAR NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    description TEXT,
    position_id INTEGER REFERENCES demo_positions(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_transactions_account_idx ON demo_transactions(account_id);
CREATE INDEX IF NOT EXISTS demo_transactions_user_idx ON demo_transactions(user_id);
CREATE INDEX IF NOT EXISTS demo_transactions_type_idx ON demo_transactions(type);
CREATE INDEX IF NOT EXISTS demo_transactions_created_idx ON demo_transactions(created_at);

-- ============================================
-- TABLE: app_settings
-- ============================================
CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- TABLE: currency_rates
-- ============================================
CREATE TABLE IF NOT EXISTS currency_rates (
    id SERIAL PRIMARY KEY,
    base_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    target_currency VARCHAR(10) NOT NULL,
    rate REAL NOT NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'frankfurter',
    fetched_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS currency_rates_base_target_idx ON currency_rates(base_currency, target_currency);

-- ============================================
-- TABLE: auto_trade_settings
-- ============================================
CREATE TABLE IF NOT EXISTS auto_trade_settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR NOT NULL REFERENCES users(id) UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    trade_units REAL NOT NULL DEFAULT 0.01,
    symbol VARCHAR(20) NOT NULL DEFAULT 'XAUUSD',
    sl_tp_mode VARCHAR(10) NOT NULL DEFAULT 'pips',
    stop_loss_value REAL NOT NULL DEFAULT 1,
    take_profit_value REAL NOT NULL DEFAULT 2,
    min_confidence INTEGER NOT NULL DEFAULT 0,
    use_ai_filter BOOLEAN NOT NULL DEFAULT false,
    stop_loss_pips REAL DEFAULT 50,
    take_profit_pips REAL DEFAULT 100,
    last_trade_at TIMESTAMP,
    last_decision VARCHAR(10),
    total_auto_trades INTEGER NOT NULL DEFAULT 0,
    closed_auto_trades INTEGER NOT NULL DEFAULT 0,
    total_auto_profit REAL NOT NULL DEFAULT 0,
    total_auto_loss REAL NOT NULL DEFAULT 0,
    winning_auto_trades INTEGER NOT NULL DEFAULT 0,
    losing_auto_trades INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auto_trade_settings_user_idx ON auto_trade_settings(user_id);

-- ============================================
-- ADD MISSING COLUMNS TO EXISTING TABLES
-- (Safe to run even if columns already exist)
-- ============================================

-- Add missing columns to auto_trade_settings
DO $$ 
BEGIN
    -- sl_tp_mode
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='sl_tp_mode') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN sl_tp_mode VARCHAR(10) NOT NULL DEFAULT 'pips';
    END IF;
    
    -- stop_loss_value
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='stop_loss_value') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN stop_loss_value REAL NOT NULL DEFAULT 1;
    END IF;
    
    -- take_profit_value
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='take_profit_value') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN take_profit_value REAL NOT NULL DEFAULT 2;
    END IF;
    
    -- min_confidence
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='min_confidence') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN min_confidence INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- use_ai_filter
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='use_ai_filter') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN use_ai_filter BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- total_auto_trades
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='total_auto_trades') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN total_auto_trades INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- closed_auto_trades
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='closed_auto_trades') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN closed_auto_trades INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- total_auto_profit
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='total_auto_profit') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN total_auto_profit REAL NOT NULL DEFAULT 0;
    END IF;
    
    -- total_auto_loss
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='total_auto_loss') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN total_auto_loss REAL NOT NULL DEFAULT 0;
    END IF;
    
    -- winning_auto_trades
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='winning_auto_trades') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN winning_auto_trades INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- losing_auto_trades
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='losing_auto_trades') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN losing_auto_trades INTEGER NOT NULL DEFAULT 0;
    END IF;
    
    -- trade_units
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='trade_units') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN trade_units REAL NOT NULL DEFAULT 0.01;
    END IF;
    
    -- use_precision_signals (NEW: Precision Auto-Trade feature)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='use_precision_signals') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN use_precision_signals BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- precision_trade_units
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='precision_trade_units') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN precision_trade_units REAL NOT NULL DEFAULT 0.01;
    END IF;
    
    -- last_precision_trade_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auto_trade_settings' AND column_name='last_precision_trade_at') THEN
        ALTER TABLE auto_trade_settings ADD COLUMN last_precision_trade_at TIMESTAMP;
    END IF;
    
    -- is_auto_trade column in demo_positions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demo_positions' AND column_name='is_auto_trade') THEN
        ALTER TABLE demo_positions ADD COLUMN is_auto_trade BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- closed_reason column in demo_positions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demo_positions' AND column_name='closed_reason') THEN
        ALTER TABLE demo_positions ADD COLUMN closed_reason VARCHAR(50);
    END IF;
    
    -- precision_batch_id column in demo_positions (for 3-leg precision trades)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demo_positions' AND column_name='precision_batch_id') THEN
        ALTER TABLE demo_positions ADD COLUMN precision_batch_id VARCHAR(100);
    END IF;
    
    -- Add precision trade plan columns to ai_suggestions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='entry_price') THEN
        ALTER TABLE ai_suggestions ADD COLUMN entry_price REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='stop_loss') THEN
        ALTER TABLE ai_suggestions ADD COLUMN stop_loss REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='take_profit_1') THEN
        ALTER TABLE ai_suggestions ADD COLUMN take_profit_1 REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='take_profit_2') THEN
        ALTER TABLE ai_suggestions ADD COLUMN take_profit_2 REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='take_profit_3') THEN
        ALTER TABLE ai_suggestions ADD COLUMN take_profit_3 REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='risk_reward_ratio') THEN
        ALTER TABLE ai_suggestions ADD COLUMN risk_reward_ratio REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='support_level') THEN
        ALTER TABLE ai_suggestions ADD COLUMN support_level REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='resistance_level') THEN
        ALTER TABLE ai_suggestions ADD COLUMN resistance_level REAL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='signal_type') THEN
        ALTER TABLE ai_suggestions ADD COLUMN signal_type VARCHAR(20) DEFAULT 'immediate';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='trade_plan') THEN
        ALTER TABLE ai_suggestions ADD COLUMN trade_plan TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_suggestions' AND column_name='valid_until') THEN
        ALTER TABLE ai_suggestions ADD COLUMN valid_until TIMESTAMP;
    END IF;
    
    -- Add missing columns to news_analysis_snapshots (for enhanced hourly AI analysis)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_analysis_snapshots' AND column_name='headline') THEN
        ALTER TABLE news_analysis_snapshots ADD COLUMN headline TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_analysis_snapshots' AND column_name='source_articles') THEN
        ALTER TABLE news_analysis_snapshots ADD COLUMN source_articles TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_analysis_snapshots' AND column_name='historical_context') THEN
        ALTER TABLE news_analysis_snapshots ADD COLUMN historical_context TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_analysis_snapshots' AND column_name='analysis_type') THEN
        ALTER TABLE news_analysis_snapshots ADD COLUMN analysis_type VARCHAR(50) DEFAULT 'regular';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_analysis_snapshots' AND column_name='generated_article') THEN
        ALTER TABLE news_analysis_snapshots ADD COLUMN generated_article TEXT;
    END IF;
    
    -- Add image_url columns for article images
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_articles' AND column_name='image_url') THEN
        ALTER TABLE news_articles ADD COLUMN image_url TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='news_analysis_snapshots' AND column_name='image_url') THEN
        ALTER TABLE news_analysis_snapshots ADD COLUMN image_url TEXT;
    END IF;
    
    -- Add missing columns to monitored_symbols
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitored_symbols' AND column_name='created_at') THEN
        ALTER TABLE monitored_symbols ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitored_symbols' AND column_name='updated_at') THEN
        ALTER TABLE monitored_symbols ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT NOW();
    END IF;
    
    -- currency column for multi-currency support (IDR, USD, etc.)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitored_symbols' AND column_name='currency') THEN
        ALTER TABLE monitored_symbols ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'USD';
    END IF;
END $$;

-- ============================================
-- SESSION TABLE (for connect-pg-simple)
-- ============================================
CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL COLLATE "default",
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
)
WITH (OIDS=FALSE);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey') THEN
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ============================================
-- RESET OLD AI SUGGESTIONS WITHOUT TRADE PLANS
-- Clear old suggestions that don't have the new precision fields
-- so fresh ones with proper entry/SL/TP data can be generated
-- ============================================
DO $$
BEGIN
    -- Delete old suggestions that don't have the precision trade plan fields
    -- This forces the system to generate new suggestions with proper data
    DELETE FROM ai_suggestions WHERE entry_price IS NULL AND decision != 'HOLD';
    RAISE NOTICE 'Cleared old suggestions without precision trade plans';
END $$;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$ 
BEGIN
    RAISE NOTICE 'Database initialization completed successfully!';
END $$;
