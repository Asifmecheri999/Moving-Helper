# Moving Helper

A single-page item tagger for logging equipment during a move: photo,
sticker number, type, packing condition, quantity, source location,
exact location, destination room at A9, and a required/not-required flag.

Backed by a shared Cloudflare D1 database + R2 bucket, so every phone
reads and writes the same list — a sticker number used on one device is
immediately unavailable on every other device, and photos are stored
server-side (R2) rather than in the phone's local storage. If a device is
offline when saving, the item is kept locally and marked "Not synced"
until the next successful sync.

The "A9 Check-in" tab lets whoever receives items search by sticker number
or name, confirm received quantity/condition (flagging quantity mismatches),
and export a receiving list.

## Architecture

- `public/index.html` — the whole front-end, static, no build step. Loads
  ExcelJS from a CDN for the Excel exports (with embedded photo thumbnails).
- `worker.js` — the Worker script, handling `/api/items` (CRUD) and
  `/api/photos` (upload/serve), backed by D1 and R2. Everything else falls
  through to `env.ASSETS` (the static site).
- `schema.sql` — the D1 table definition. Run once, by hand, in the D1
  database's Console tab in the Cloudflare dashboard.
- `wrangler.jsonc` — binds the Worker to `./public` (assets), D1 (`DB`),
  and R2 (`PHOTOS`). Kept separate from `public/` so `.git`, `README.md`,
  and `wrangler.jsonc` itself are never uploaded as static assets.

## Run locally

```bash
npx wrangler dev
```

## Deploy

Push to `main` — Cloudflare's Git integration auto-deploys (requires the
GitHub connection to have access to this repo, which is public).

One-time setup after cloning/forking:
1. Create a D1 database and an R2 bucket in the Cloudflare dashboard, and
   fill in their names/IDs in `wrangler.jsonc`.
2. Open the D1 database's **Console** tab and run the contents of
   `schema.sql` once, to create the `items` table.
