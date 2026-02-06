-- Migration: Add logs table for D1-based logging
-- Replaces KV-based logging for better consistency and queryability

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
  message TEXT NOT NULL,
  symbol TEXT,
  operation TEXT,
  data TEXT, -- JSON string for structured data
  error TEXT, -- JSON string for error details
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_request_id ON logs(request_id);
CREATE INDEX IF NOT EXISTS idx_logs_symbol ON logs(symbol);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_operation ON logs(operation);

-- Compound index for common query patterns
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_symbol ON logs(timestamp DESC, symbol);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_level ON logs(timestamp DESC, level);
