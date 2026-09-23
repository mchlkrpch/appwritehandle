const https = require('https');
const http = require('http');
const dns = require('dns');

// 1. Используем IPv4 для DNS-резолвинга
dns.setDefaultResultOrder('ipv4first');

// 2. Полифил fetch — обязателен, иначе на некоторых регионах Appwrite Cloud
// встроенный undici fetch зависает на IPv6 и функция падает по таймауту (408)
global.fetch = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;

    let reqHeaders = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach((value, key) => reqHeaders[key] = value);
      } else if (typeof options.headers.entries === 'function') {
        for (const [key, value] of options.headers.entries()) reqHeaders[key] = value;
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

const { Client, TablesDB, Permission, Role, Query } = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  log(`--- EXECUTING GRAPH COLLABORATORS UPDATE ---`);

  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const tablesDB = new TablesDB(client);

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

  // databaseId и tableId — теперь это ID базы и ID таблицы (бывшая collection)
  const { databaseId, tableId, graphId, collaborators } = body;

  if (!databaseId || !tableId || !graphId || !collaborators) {
    return res.json({ error: 'missing fields' }, 400);
  }

  let row;
  log(`Searching for graphId (rowId): ${graphId}`);

  try {
    const response = await tablesDB.listRows(
      databaseId,
      tableId,
      [Query.equal('$id', graphId), Query.limit(1)]
    );

    if (response.rows.length === 0) {
      log('Graph not found in database');
      return res.json({ error: 'graph not found' }, 404);
    }
    row = response.rows[0];
    log(`Success! Graph row found: ${row.$id}`);
  } catch (e) {
    log(`CRITICAL ERROR ON READ: ${e.message}`);
    error(`Database read error: ${e.message}`);
    return res.json({ error: 'database error on read', details: e.message }, 500);
  }

  if (row.owner !== callerUserId) {
    return res.json({ error: 'forbidden: only owner can manage collaborators' }, 403);
  }

  const permissions = [
    Permission.read(Role.any()),
    Permission.update(Role.user(row.owner)),
    Permission.delete(Role.user(row.owner)),
  ];

  Object.entries(collaborators).forEach(([userId, role]) => {
    if (userId === row.owner) return;
    if (role === 'editor') {
      permissions.push(Permission.update(Role.user(userId)));
    }
  });

  try {
    const updated = await tablesDB.updateRow(
      databaseId,
      tableId,
      graphId,
      { collaborators: JSON.stringify(collaborators) },
      permissions
    );
    log(`Successfully updated collaborators for: ${updated.$id}`);
    return res.json({ success: true, document: updated });
  } catch (e) {
    log(`CRITICAL ERROR ON UPDATE: ${e.message}`);
    error(`Database update error: ${e.message}`);
    return res.json({ error: 'update failed', details: e.message }, 500);
  }
};
