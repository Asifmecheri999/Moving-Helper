# Moving Helper

A single-page item tagger for logging equipment during a move: photo, sticker
number, quantity, source/destination, owner, and a take/leave flag. Everything
is saved to the browser's `localStorage`, with optional sync to a Cloudflare
Worker API (paste its URL on the Log tab) so multiple phones share one list.
The "A9 Check-in" tab lets whoever receives items at the destination scan a
sticker number and confirm received quantity/condition against that shared
list.

It's a single static file — `index.html` — no build step, no dependencies.

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

This repo includes `wrangler.jsonc` configured for Cloudflare Workers Static
Assets (same pattern as the ecoflowuae site). To deploy:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Import a Git
   repository**, and select this repo. Cloudflare will pick up
   `wrangler.jsonc` automatically and deploy on every push to `main`.
2. Or, from the CLI with a Cloudflare API token: `npx wrangler deploy`.

## Cloud sync API

The app expects a Worker API with two endpoints under `/items`:

- `POST /items` — accepts an item (or `{kind: "checkin", ...}` payload) and
  stores it.
- `GET /items` — returns all stored items as a JSON array.

Paste that Worker's URL into the "Cloud API URL" field on the Log tab.
