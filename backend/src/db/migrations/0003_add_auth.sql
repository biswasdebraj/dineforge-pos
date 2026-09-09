CREATE TABLE IF NOT EXISTS role_pins (
    role TEXT PRIMARY KEY CHECK (role IN ('waiter', 'kitchen', 'admin')),
    pin_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('waiter', 'kitchen', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- The Phase 7 single admin PIN is superseded by role_pins('admin', ...);
-- this app has no real installs yet, so no data migration is needed.
DELETE FROM settings WHERE key = 'admin_pin_hash';
