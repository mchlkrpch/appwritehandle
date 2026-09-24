const https = require('https');
const http = require('http');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

global.fetch = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    let reqHeaders = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach((value, key) => reqHeaders[key] = value);
      } else {
        reqHeaders = { ...options.headers };
      }
    }
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: reqHeaders,
    }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const bodyStr = Buffer.concat(data).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: { get: (name) => res.headers[name.toLowerCase()] || null },
          json: async () => JSON.parse(bodyStr),
          text: async () => bodyStr,
          arrayBuffer: async () => Buffer.concat(data)
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Polyfill fetch timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
};

const ENDPOINT = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_FUNCTION_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;

async function appwriteRequest(method, path, body) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': PROJECT_ID,
      'X-Appwrite-Key': API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}

// ── Конфигурация правил для разных таблиц ──
// Если таблица не описана здесь — применяется дефолтное правило
// "разрешено редактировать только собственный документ (id === callerUserId)".
const TABLE_RULES = {
  graphs: {
    // Поля, которые может менять и owner, и editor
    sharedFields: ['content', 'name', 'groups'],
    // Поля, которые может менять ТОЛЬКО owner
    ownerOnlyFields: ['collaborators'],
    // Проверка прав на основе полей документа
    checkAccess: (row, callerUserId) => {
      const isOwner = row.owner === callerUserId;
      let collaborators = {};
      try {
        collaborators = row.collaborators ? JSON.parse(row.collaborators) : {};
      } catch (e) { /* ignore */ }
      const isEditor = collaborators[callerUserId] === 'editor';
      return { isOwner, isEditor };
    },
  },
};

module.exports = async ({ req, res, log, error }) => {
  log(`--- EXECUTING DOCUMENT UPDATE ---`);

  const callerUserId = req.headers['x-appwrite-user-id'];
  if (!callerUserId) {
    return res.json({ error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = JSON.parse(req.bodyRaw || '{}');
  } catch (e) {
    return res.json({ error: 'invalid body' }, 400);
  }

  const { databaseId, tableId, id, data } = body;

  if (!databaseId || !tableId || !id || !data || typeof data !== 'object') {
    log(`Missing fields. Received: ${JSON.stringify(body)}`);
    return res.json({ error: 'missing fields' }, 400);
  }

  // ── Читаем документ ──
  let row;
  try {
    const q1 = encodeURIComponent(JSON.stringify({ method: 'equal', attribute: '$id', values: [id] }));
    const q2 = encodeURIComponent(JSON.stringify({ method: 'limit', values: [1] }));
    const listResp = await appwriteRequest(
      'GET',
      `/tablesdb/${databaseId}/tables/${tableId}/rows?queries[]=${q1}&queries[]=${q2}`
    );

    if (!listResp.rows || listResp.rows.length === 0) {
      log('Document not found');
      return res.json({ error: 'document not found' }, 404);
    }
    row = listResp.rows[0];
  } catch (e) {
    log(`CRITICAL ERROR ON READ: ${e.message}`);
    error(`Database read error: ${e.message}`);
    return res.json({ error: 'database error on read', details: e.message }, 500);
  }
  log(`DEBUG: row.owner=${row.owner}, callerUserId=${callerUserId}, collaborators=${row.collaborators}`);

  // ── Определяем правила доступа для этой таблицы ──
  const rules = TABLE_RULES[tableId];
  const requestedFields = Object.keys(data);
  const updateData = {};

  if (rules) {
    const { isOwner, isEditor } = rules.checkAccess(row, callerUserId);

    if (!isOwner && !isEditor) {
      log(`Forbidden: user ${callerUserId} has no access (owner=${row.owner})`);
      return res.json({ error: 'forbidden: no edit access' }, 403);
    }

    for (const field of requestedFields) {
      const isOwnerOnly = rules.ownerOnlyFields.includes(field);
      const isShared = rules.sharedFields.includes(field);

      if (isOwnerOnly && !isOwner) {
        log(`Forbidden: field "${field}" requires owner, caller=${callerUserId}`);
        return res.json({ error: `forbidden: only owner can change "${field}"` }, 403);
      }
      if (!isOwnerOnly && !isShared) {
        log(`Forbidden: field "${field}" is not editable`);
        return res.json({ error: `forbidden: field "${field}" is not editable` }, 403);
      }
      updateData[field] = data[field];
    }
  } else {
    // ── Дефолтное правило для остальных таблиц: можно менять только свой документ ──
    if (row.$id !== callerUserId) {
      log(`Forbidden: user ${callerUserId} tried to edit foreign document ${row.$id} in table ${tableId}`);
      return res.json({ error: 'forbidden: not your document' }, 403);
    }
    Object.assign(updateData, data);
  }

  if (Object.keys(updateData).length === 0) {
    return res.json({ error: 'no allowed fields to update' }, 400);
  }

  // ── Обновляем ──
  try {
    const updated = await appwriteRequest(
      'PATCH',
      `/tablesdb/${databaseId}/tables/${tableId}/rows/${id}`,
      { data: updateData }
    );
    log(`Successfully updated document ${updated.$id} in table ${tableId}`);
    return res.json({ success: true, document: updated });
  } catch (e) {
    log(`CRITICAL ERROR ON UPDATE: ${e.message}`);
    error(`Database update error: ${e.message}`);
    return res.json({ error: 'update failed', details: e.message }, 500);
  }
};
