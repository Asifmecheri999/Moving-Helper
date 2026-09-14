CREATE TABLE IF NOT EXISTS inventory_items (
  sticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  packing TEXT,
  qty INTEGER,
  location TEXT,
  location_detail TEXT,
  owner TEXT,
  photo_key TEXT,
  photos TEXT,
  comments TEXT,
  ts TEXT,
  created_by TEXT
);
