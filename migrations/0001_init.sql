-- Saved designs. The script is the source of truth; messages preserve the chat
-- so a design reopens mid-conversation. uid scopes ownership (anonymous cookie).
CREATE TABLE IF NOT EXISTS designs (
  id         TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  script     TEXT NOT NULL DEFAULT '',
  messages   TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_designs_uid ON designs (uid, updated_at DESC);
