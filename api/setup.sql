-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    is_active BOOLEAN DEFAULT true,
    selected_asset TEXT DEFAULT 'ALL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_alert_at TIMESTAMP
);

-- Asset subscriptions
CREATE TABLE IF NOT EXISTS asset_subscriptions (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    asset_symbol TEXT NOT NULL,
    subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chat_id, asset_symbol)
);

-- Alert history
CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    asset_symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    schaff_value DECIMAL(5,2),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Last signals
CREATE TABLE IF NOT EXISTS last_signals (
    id SERIAL PRIMARY KEY,
    asset_symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    schaff_value DECIMAL(5,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asset_symbol, timeframe)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_asset_subs_chat ON asset_subscriptions(chat_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_chat ON alert_history(chat_id);
