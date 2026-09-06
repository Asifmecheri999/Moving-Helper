CREATE TABLE IF NOT EXISTS items (
  sticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  packing TEXT,
  qty INTEGER,
  location TEXT,
  location_detail TEXT,
  destination TEXT,
  destination_detail TEXT,
  owner TEXT,
  flag TEXT,
  photo_key TEXT,
  ts TEXT,
  received_qty INTEGER,
  condition TEXT,
  checked_at TEXT,
  arrived INTEGER DEFAULT 0,
  created_by TEXT
);

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

CREATE TABLE IF NOT EXISTS catalog (
  name TEXT PRIMARY KEY,
  qty INTEGER
);
