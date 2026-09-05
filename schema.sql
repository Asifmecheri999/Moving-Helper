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
  arrived INTEGER DEFAULT 0
);
