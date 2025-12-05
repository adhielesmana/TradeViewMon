-- Migration: Add new auto-trade settings columns
-- Run this on your production database to add missing columns

-- Add sl_tp_mode column (pips or percentage mode)
ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS sl_tp_mode VARCHAR(10) NOT NULL DEFAULT 'pips';

-- Add stop_loss_value column (value based on mode)
ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS stop_loss_value REAL NOT NULL DEFAULT 1;

-- Add take_profit_value column (value based on mode)
ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS take_profit_value REAL NOT NULL DEFAULT 2;

-- Add min_confidence column (0-100, 0 = disabled)
ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS min_confidence INTEGER NOT NULL DEFAULT 0;

-- Add use_ai_filter column
ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS use_ai_filter BOOLEAN NOT NULL DEFAULT false;

-- Add trade tracking columns if missing
ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS total_auto_trades INTEGER NOT NULL DEFAULT 0;

ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS closed_auto_trades INTEGER NOT NULL DEFAULT 0;

ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS total_auto_profit REAL NOT NULL DEFAULT 0;

ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS total_auto_loss REAL NOT NULL DEFAULT 0;

ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS winning_auto_trades INTEGER NOT NULL DEFAULT 0;

ALTER TABLE auto_trade_settings 
ADD COLUMN IF NOT EXISTS losing_auto_trades INTEGER NOT NULL DEFAULT 0;

-- Migration complete
SELECT 'Migration completed successfully' as status;
