function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function rowToItem(row) {
  return {
    sticker: row.sticker,
    name: row.name,
    type: row.type,
    packing: row.packing,
    qty: row.qty,
    location: row.location,
    locationDetail: row.location_detail,
    destination: row.destination,
    destinationDetail: row.destination_detail,
    owner: row.owner,
    flag: row.flag,
    photo: row.photo_key,
    ts: row.ts,
    receivedQty: row.received_qty,
    condition: row.condition,
    checkedAt: row.checked_at,
    arrived: !!row.arrived
  };
}

async function listItems(env) {
  const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY sticker').all();
  return jsonResponse(results.map(rowToItem));
}

async function createItem(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  if (!body.sticker || !body.name) return jsonResponse({ error: 'sticker and name required' }, 400);
  try {
    await env.DB.prepare(
      `INSERT INTO items (sticker, name, type, packing, qty, location, location_detail, destination, destination_detail, owner, flag, photo_key, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.sticker, body.name, body.type || '', body.packing || '', body.qty || 0,
      body.location || '', body.locationDetail || '', body.destination || '', body.destinationDetail || '',
      body.owner || '', body.flag || '', body.photo || null, body.ts || new Date().toISOString()
    ).run();
  } catch (e) {
    if (String(e.message || e).includes('UNIQUE')) {
      return jsonResponse({ error: 'sticker already used' }, 409);
    }
    return jsonResponse({ error: String(e.message || e) }, 500);
  }
  return jsonResponse({ ok: true }, 201);
}

const UPDATABLE_FIELDS = {
  name: 'name', type: 'type', packing: 'packing', qty: 'qty',
  location: 'location', locationDetail: 'location_detail',
  destination: 'destination', destinationDetail: 'destination_detail',
  owner: 'owner', flag: 'flag', photo: 'photo_key',
  receivedQty: 'received_qty', condition: 'condition', checkedAt: 'checked_at', arrived: 'arrived'
};

async function updateItem(sticker, request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  const sets = [];
  const values = [];
  for (const [key, col] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      sets.push(`${col} = ?`);
      values.push(key === 'arrived' ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (sets.length === 0) return jsonResponse({ error: 'nothing to update' }, 400);
  values.push(sticker);
  const result = await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE sticker = ?`).bind(...values).run();
  if (!result.meta.changes) return jsonResponse({ error: 'not found' }, 404);
  return jsonResponse({ ok: true });
}

async function deleteItem(sticker, env) {
  const row = await env.DB.prepare('SELECT photo_key FROM items WHERE sticker = ?').bind(sticker).first();
  await env.DB.prepare('DELETE FROM items WHERE sticker = ?').bind(sticker).run();
  if (row && row.photo_key) {
    try { await env.PHOTOS.delete(row.photo_key); } catch (e) {}
  }
  return jsonResponse({ ok: true });
}

async function uploadPhoto(request, env) {
  const contentType = request.headers.get('content-type') || 'image/jpeg';
  const buf = await request.arrayBuffer();
  const key = `${crypto.randomUUID()}.jpg`;
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType } });
  return jsonResponse({ key });
}

async function getPhoto(key, env) {
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/items' && request.method === 'GET') return listItems(env);
    if (path === '/api/items' && request.method === 'POST') return createItem(request, env);

    let m = path.match(/^\/api\/items\/([^/]+)$/);
    if (m) {
      const sticker = decodeURIComponent(m[1]);
      if (request.method === 'PATCH') return updateItem(sticker, request, env);
      if (request.method === 'DELETE') return deleteItem(sticker, env);
    }

    if (path === '/api/photos' && request.method === 'POST') return uploadPhoto(request, env);
    m = path.match(/^\/api\/photos\/([^/]+)$/);
    if (m && request.method === 'GET') return getPhoto(decodeURIComponent(m[1]), env);

    return env.ASSETS.fetch(request);
  }
};
