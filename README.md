# Moving Helper

A single-page item tagger for logging equipment during a move: photo,
sticker number, type, packing condition, quantity, source location,
exact location, destination room at A9, and a take/leave flag. Everything
is saved to the browser's `localStorage` — it's currently a single-device
tool, with no shared backend yet.

The "A9 Check-in" tab lets whoever receives items search by sticker number
or name, confirm received quantity/condition, and export a receiving list.

It's a static site — just `public/index.html`, no build step, no
dependencies other than the ExcelJS library loaded from a CDN for the
Excel export.

## Run locally

Just open `public/index.html` in a browser, or serve the folder:

```bash
npx serve public
```

## Deploy

This repo includes `wrangler.jsonc` configured for Cloudflare Workers Static
Assets, pointed at `./public` (kept separate from the repo root so `.git`,
`README.md`, and `wrangler.jsonc` itself are never uploaded as public
static assets).

1. In the Cloudflare dashboard: **Workers & Pages → Create → Import a Git
   repository**, and select this repo. Cloudflare will pick up
   `wrangler.jsonc` automatically and deploy on every push to `main`
   (requires the GitHub connection to have access to this repo).
2. Or, from the CLI with a Cloudflare API token: `npx wrangler deploy`.

Now that this repo is public, Cloudflare's Git integration should redeploy
automatically on every push to `main`. (auto-deploy check: v2)
