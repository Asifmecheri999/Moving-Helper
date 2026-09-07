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

function parseTeams(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function getUserByUsername(username, env, cols) {
  try {
    return await env.DB.prepare(`SELECT ${cols.join(', ')}, teams FROM users WHERE username = ?`).bind(username).first();
  } catch (e) {
    const row = await env.DB.prepare(`SELECT ${cols.join(', ')} FROM users WHERE username = ?`).bind(username).first();
    return row ? { ...row, teams: null } : row;
  }
}

async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const row = await env.DB.prepare('SELECT username FROM sessions WHERE token = ?').bind(token).first();
  if (!row) return null;
  const user = await getUserByUsername(row.username, env, ['username', 'role']);
  if (!user) return null;
  return { ...user, teams: parseTeams(user.teams) };
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

  let user = await getUserByUsername(username, env, ['username', 'salt', 'code_hash', 'role']);
  if (!user) {
    const salt = crypto.randomUUID();
    const codeHash = await sha256Hex(salt + code);
    try {
      await env.DB.prepare('INSERT INTO users (username, salt, code_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(username, salt, codeHash, 'user', new Date().toISOString()).run();
    } catch (e) {
      return jsonResponse({ error: 'that username was just taken, try again' }, 409);
    }
    user = { username, salt, code_hash: codeHash, role: 'user', teams: null };
  } else {
    const hash = await sha256Hex(user.salt + code);
    if (hash !== user.code_hash) return jsonResponse({ error: 'wrong code for that username' }, 401);
  }

  const token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .bind(token, user.username, new Date().toISOString()).run();
  return jsonResponse({ token, username: user.username, role: user.role, teams: parseTeams(user.teams) });
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

  let newSticker = null;
  if (Object.prototype.hasOwnProperty.call(body, 'sticker')) {
    const trimmed = String(body.sticker || '').trim();
    if (!trimmed) return jsonResponse({ error: 'sticker cannot be empty' }, 400);
    if (trimmed !== sticker) {
      const clash = await env.DB.prepare('SELECT 1 FROM items WHERE sticker = ?').bind(trimmed).first();
      if (clash) return jsonResponse({ error: 'sticker already used' }, 409);
      newSticker = trimmed;
    }
  }

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
  if (newSticker) {
    sets.push('sticker = ?');
    values.push(newSticker);
  }
  if (sets.length === 0) return jsonResponse({ error: 'nothing to update' }, 400);
  values.push(sticker);
  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE sticker = ?`).bind(...values).run();
  return jsonResponse({
    ok: true,
    claimed: isUnclaimed && session.role !== 'admin' ? session.username : undefined,
    newSticker: newSticker || undefined
  });
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
  try {
    const { results } = await env.DB.prepare('SELECT username, role, teams, created_at FROM users ORDER BY username').all();
    return jsonResponse(results.map(r => ({ ...r, teams: parseTeams(r.teams) })));
  } catch (e) {
    const { results } = await env.DB.prepare('SELECT username, role, created_at FROM users ORDER BY username').all();
    return jsonResponse(results.map(r => ({ ...r, teams: [] })));
  }
}

async function deleteUser(username, env) {
  if (username === 'adminasif') return jsonResponse({ error: 'cannot delete the primary admin' }, 403);
  await env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
  return jsonResponse({ ok: true });
}

function cleanTeamsInput(raw) {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map(t => String(t || '').trim()).filter(Boolean)));
}

async function createTeamUser(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  const username = String(body?.username || '').trim();
  const code = String(body?.code || '').trim();
  const teams = cleanTeamsInput(body?.teams);
  if (!username || !/^\d{4}$/.test(code)) return jsonResponse({ error: 'enter a username and a 4-digit code' }, 400);
  const salt = crypto.randomUUID();
  const codeHash = await sha256Hex(salt + code);
  try {
    await env.DB.prepare('INSERT INTO users (username, salt, code_hash, role, teams, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(username, salt, codeHash, 'user', teams.length ? JSON.stringify(teams) : null, new Date().toISOString()).run();
  } catch (e) {
    return jsonResponse({ error: 'that username is already taken' }, 409);
  }
  return jsonResponse({ ok: true }, 201);
}

async function setUserTeams(username, request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  const teams = cleanTeamsInput(body?.teams);
  const existing = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
  if (!existing) return jsonResponse({ error: 'not found' }, 404);
  await env.DB.prepare('UPDATE users SET teams = ? WHERE username = ?').bind(teams.length ? JSON.stringify(teams) : null, username).run();
  return jsonResponse({ ok: true });
}

async function getTeams(env) {
  const { results } = await env.DB.prepare('SELECT name FROM teams ORDER BY name').all();
  return jsonResponse(results.map(r => r.name));
}

async function addTeam(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  const name = String(body?.name || '').trim();
  if (!name) return jsonResponse({ error: 'team name required' }, 400);
  await env.DB.prepare('INSERT OR IGNORE INTO teams (name) VALUES (?)').bind(name).run();
  return jsonResponse({ ok: true });
}

async function deleteTeam(name, env) {
  await env.DB.prepare('DELETE FROM teams WHERE name = ?').bind(name).run();
  return jsonResponse({ ok: true });
}

async function getLocations(env) {
  const { results } = await env.DB.prepare('SELECT name FROM locations ORDER BY name').all();
  return jsonResponse(results.map(r => r.name));
}

async function addLocation(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'bad json' }, 400); }
  const name = String(body?.name || '').trim();
  if (!name) return jsonResponse({ error: 'location name required' }, 400);
  await env.DB.prepare('INSERT OR IGNORE INTO locations (name) VALUES (?)').bind(name).run();
  return jsonResponse({ ok: true });
}

async function deleteLocation(name, env) {
  await env.DB.prepare('DELETE FROM locations WHERE name = ?').bind(name).run();
  return jsonResponse({ ok: true });
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
      if (path === '/api/teams' && request.method === 'GET') return getTeams(env);
      if (path === '/api/locations' && request.method === 'GET') return getLocations(env);

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
      if (path === '/api/users' && request.method === 'POST') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return createTeamUser(request, env);
      }
      m = path.match(/^\/api\/users\/([^/]+)$/);
      if (m && request.method === 'DELETE') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return deleteUser(decodeURIComponent(m[1]), env);
      }
      if (m && request.method === 'PATCH') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return setUserTeams(decodeURIComponent(m[1]), request, env);
      }

      if (path === '/api/teams/add' && request.method === 'POST') return addTeam(request, env);
      m = path.match(/^\/api\/teams\/([^/]+)$/);
      if (m && request.method === 'DELETE') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return deleteTeam(decodeURIComponent(m[1]), env);
      }

      if (path === '/api/locations/add' && request.method === 'POST') return addLocation(request, env);
      m = path.match(/^\/api\/locations\/([^/]+)$/);
      if (m && request.method === 'DELETE') {
        if (session.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);
        return deleteLocation(decodeURIComponent(m[1]), env);
      }

      return jsonResponse({ error: 'not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
