function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const row = await env.DB.prepare('SELECT username FROM sessions WHERE token = ?').bind(token).first();
  if (!row) return null;
  const user = await env.DB.prepare('SELECT username, role FROM users WHERE username = ?').bind(row.username).first();
  return user || null;
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
    arrived: !!row.arrived,
    createdBy: row.created_by
  };
}

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  const username = (body.username || '').trim();
  const code = (body.code || '').trim();
  if (!username || !/^\d{4}$/.test(code)) return jsonResponse({ error: 'enter a username and a 4-digit code' }, 400);

  let user = await env.DB.prepare('SELECT username, salt, code_hash, role FROM users WHERE username = ?').bind(username).first();
  if (!user) {
    const salt = crypto.randomUUID();
    const codeHash = await sha256Hex(salt + code);
    try {
      await env.DB.prepare('INSERT INTO users (username, salt, code_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(username, salt, codeHash, 'user', new Date().toISOString()).run();
    } catch (e) {
      return jsonResponse({ error: 'that username was just taken, try again' }, 409);
    }
    user = { username, salt, code_hash: codeHash, role: 'user' };
  } else {
    const hash = await sha256Hex(user.salt + code);
    if (hash !== user.code_hash) return jsonResponse({ error: 'wrong code for that username' }, 401);
  }

  const token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .bind(token, user.username, new Date().toISOString()).run();
  return jsonResponse({ token, username: user.username, role: user.role });
}

async function logout(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return jsonResponse({ ok: true });
}

async function listItems(env) {
  const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY sticker').all();
  return jsonResponse(results.map(rowToItem));
}

async function createItem(request, env, session) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  if (!body.sticker || !body.name) return jsonResponse({ error: 'sticker and name required' }, 400);
  try {
    await env.DB.prepare(
      `INSERT INTO items (sticker, name, type, packing, qty, location, location_detail, destination, destination_detail, owner, flag, photo_key, ts, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.sticker, body.name, body.type || '', body.packing || '', body.qty || 0,
      body.location || '', body.locationDetail || '', body.destination || '', body.destinationDetail || '',
      body.owner || '', body.flag || '', body.photo || null, body.ts || new Date().toISOString(),
      session.username
    ).run();
  } catch (e) {
    if (String(e.message || e).includes('UNIQUE')) {
      return jsonResponse({ error: 'sticker already used' }, 409);
    }
    return jsonResponse({ error: String(e.message || e) }, 500);
  }
  return jsonResponse({ ok: true }, 201);
}

async function bulkCreateItems(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  if (!Array.isArray(body)) return jsonResponse({ error: 'expected an array of {name, qty, location}' }, 400);
  const rows = body
    .map(r => ({
      name: String(r?.name || '').trim(),
      qty: Number(r?.qty) || 0,
      location: String(r?.location || '').trim()
    }))
    .filter(r => r.name)
    .slice(0, 2000);
  if (!rows.length) return jsonResponse({ error: 'no valid rows' }, 400);

  const maxRow = await env.DB.prepare('SELECT MAX(CAST(sticker AS INTEGER)) as m FROM items').first();
  let next = (maxRow && maxRow.m ? maxRow.m : 0) + 1;
  const now = new Date().toISOString();

  const stmts = rows.map(r => {
    const sticker = String(next++).padStart(5, '0');
    return env.DB.prepare(
      `INSERT INTO items (sticker, name, qty, location, destination, ts, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).bind(sticker, r.name, r.qty, r.location, 'A9 Warehouse', now);
  });
  await env.DB.batch(stmts);
  return jsonResponse({ ok: true, count: rows.length });
}

const UPDATABLE_FIELDS = {
  name: 'name', type: 'type', packing: 'packing', qty: 'qty',
  location: 'location', locationDetail: 'location_detail',
  destination: 'destination', destinationDetail: 'destination_detail',
  owner: 'owner', flag: 'flag', photo: 'photo_key',
  receivedQty: 'received_qty', condition: 'condition', checkedAt: 'checked_at', arrived: 'arrived'
};

async function updateItem(sticker, request, env, session) {
  const existing = await env.DB.prepare('SELECT created_by FROM items WHERE sticker = ?').bind(sticker).first();
  if (!existing) return jsonResponse({ error: 'not found' }, 404);
  const isUnclaimed = !existing.created_by;
  if (session.role !== 'admin' && !isUnclaimed && existing.created_by !== session.username) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }
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
  if (isUnclaimed && session.role !== 'admin') {
    sets.push('created_by = ?');
    values.push(session.username);
  }
  if (sets.length === 0) return jsonResponse({ error: 'nothing to update' }, 400);
  values.push(sticker);
  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE sticker = ?`).bind(...values).run();
  return jsonResponse({ ok: true, claimed: isUnclaimed && session.role !== 'admin' ? session.username : undefined });
}

async function deleteItem(sticker, env, session) {
  const row = await env.DB.prepare('SELECT photo_key, created_by FROM items WHERE sticker = ?').bind(sticker).first();
  if (!row) return jsonResponse({ error: 'not found' }, 404);
  if (session.role !== 'admin' && row.created_by !== session.username) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }
  await env.DB.prepare('DELETE FROM items WHERE sticker = ?').bind(sticker).run();
  if (row.photo_key) {
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

async function listUsers(env) {
  const { results } = await env.DB.prepare('SELECT username, role, created_at FROM users ORDER BY username').all();
  return jsonResponse(results);
}

async function deleteUser(username, env) {
  if (username === 'adminasif') return jsonResponse({ error: 'cannot delete the primary admin' }, 403);
  await env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
  return jsonResponse({ ok: true });
}

async function getCatalog(env) {
  const { results } = await env.DB.prepare('SELECT name, qty FROM catalog ORDER BY name').all();
  return jsonResponse(results);
}

async function replaceCatalog(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  if (!Array.isArray(body)) return jsonResponse({ error: 'expected an array of {name, qty}' }, 400);
  const rows = body
    .map(r => ({ name: String(r?.name || '').trim(), qty: Number(r?.qty) || 0 }))
    .filter(r => r.name)
    .slice(0, 5000);
  await env.DB.prepare('DELETE FROM catalog').run();
  if (rows.length) {
    const stmts = rows.map(r => env.DB.prepare('INSERT OR REPLACE INTO catalog (name, qty) VALUES (?, ?)').bind(r.name, r.qty));
    await env.DB.batch(stmts);
  }
  return jsonResponse({ ok: true, count: rows.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/login' && request.method === 'POST') return login(request, env);

    if (path.startsWith('/api/photos/') && request.method === 'GET') {
      return getPhoto(decodeURIComponent(path.slice('/api/photos/'.length)), env);
    }

    if (path.startsWith('/api/')) {
      const session = await getSession(request, env);
      if (!session) return jsonResponse({ error: 'unauthorized' }, 401);

      if (path === '/api/logout' && request.method === 'POST') return logout(request, env);
      if (path === '/api/items' && request.method === 'GET') return listItems(env);
      if (path === '/api/items' && request.method === 'POST') return createItem(request, env, session);
      if (path === '/api/items/bulk' && request.method === 'POST') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return bulkCreateItems(request, env);
      }

      let m = path.match(/^\/api\/items\/([^/]+)$/);
      if (m) {
        const sticker = decodeURIComponent(m[1]);
        if (request.method === 'PATCH') return updateItem(sticker, request, env, session);
        if (request.method === 'DELETE') return deleteItem(sticker, env, session);
      }

      if (path === '/api/photos' && request.method === 'POST') return uploadPhoto(request, env);

      if (path === '/api/users' && request.method === 'GET') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return listUsers(env);
      }
      m = path.match(/^\/api\/users\/([^/]+)$/);
      if (m && request.method === 'DELETE') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return deleteUser(decodeURIComponent(m[1]), env);
      }

      if (path === '/api/catalog' && request.method === 'GET') return getCatalog(env);
      if (path === '/api/catalog' && request.method === 'POST') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return replaceCatalog(request, env);
      }

      return jsonResponse({ error: 'not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
