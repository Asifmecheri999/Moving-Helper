ALTER TABLE items ADD COLUMN created_by TEXT;

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT
);

INSERT INTO users (username, salt, code_hash, role, created_at) VALUES (
  'adminasif',
  '1f21c26b-2c7d-41a4-bf2a-99d4e1865713',
  '1ea705a7f6fbbf4e4bb014d8d19e55fcfc8ae7334fc3b4ea618bc99ffad8cbf1',
  'admin',
  '2026-09-06T00:00:00.000Z'
);
