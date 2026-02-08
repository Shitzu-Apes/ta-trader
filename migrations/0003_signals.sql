-- Migration: Add signals table for D1-based signal storage
-- Replaces KV-based signals for better queryability and rate limit compliance

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ENTRY', 'EXIT', 'HOLD', 'NO_ACTION', 'ADJUSTMENT', 'STOP_LOSS', 'TAKE_PROFIT')),
  direction TEXT CHECK (direction IN ('LONG', 'SHORT')),
  action TEXT CHECK (action IN ('OPEN', 'CLOSE', 'INCREASE', 'DECREASE')),
  reason TEXT CHECK (reason IN ('TA_SCORE', 'STOP_LOSS', 'TAKE_PROFIT', 'SIGNAL_REVERSAL', 'BELOW_THRESHOLD', 'PROFIT_TAKING', 'TIME_DECAY', 'STRENGTHENED_SIGNAL', 'WEAKENED_SIGNAL')),
  ta_score REAL NOT NULL,
  threshold REAL NOT NULL,
  price REAL NOT NULL,
  position_size REAL,
  entry_price REAL,
  unrealized_pnl REAL,
  realized_pnl REAL,
  -- Indicator data stored as JSON
  indicators TEXT,
  -- Dynamic position sizing fields
  target_size REAL,
  current_size REAL,
  initial_notional_size REAL,
  intensity REAL,
  available_leverage REAL,
  -- Score multipliers
  profit_score REAL,
  time_decay_score REAL,
  consensus_status TEXT CHECK (consensus_status IN ('long', 'short', 'none')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_signals_symbol_timestamp ON signals(symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_type ON signals(symbol, type);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(type);

-- Compound index for common query patterns
CREATE INDEX IF NOT EXISTS idx_signals_symbol_type_timestamp ON signals(symbol, type, timestamp DESC);
