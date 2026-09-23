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
  if (!res.ok) {
    throw new Error(json.message || `HTTP ${res.status}`);
  }
  return json;
}

module.exports = async ({ req, res, log, error }) => {
  log(`--- EXECUTING GRAPH COLLABORATORS UPDATE ---`);

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

  const { databaseId, tableId, graphId, collaborators } = body;

  if (!databaseId || !tableId || !graphId || !collaborators) {
    return res.json({ error: 'missing fields' }, 400);
  }

  let row;
  log(`Searching for graphId (rowId): ${graphId}`);

  try {
    const query = encodeURIComponent(JSON.stringify({ method: 'equal', attribute: '$id', values: [graphId] }));
    const listResp = await appwriteRequest(
      'GET',
      `/tablesdb/${databaseId}/tables/${tableId}/rows?queries[]=${query}&queries[]=${encodeURIComponent(JSON.stringify({ method: 'limit', values: [1] }))}`
    );

    if (!listResp.rows || listResp.rows.length === 0) {
      log('Graph not found in database');
      return res.json({ error: 'graph not found' }, 404);
    }
    row = listResp.rows[0];
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
    `read("any")`,
    `update("user:${row.owner}")`,
    `delete("user:${row.owner}")`,
  ];

  Object.entries(collaborators).forEach(([userId, role]) => {
    if (userId === row.owner) return;
    if (role === 'editor') {
      permissions.push(`update("user:${userId}")`);
    }
  });

  try {
    const updated = await appwriteRequest(
      'PATCH',
      `/tablesdb/${databaseId}/tables/${tableId}/rows/${graphId}`,
      {
        data: { collaborators: JSON.stringify(collaborators) },
        permissions,
      }
    );
    log(`Successfully updated collaborators for: ${updated.$id}`);
    return res.json({ success: true, document: updated });
  } catch (e) {
    log(`CRITICAL ERROR ON UPDATE: ${e.message}`);
    error(`Database update error: ${e.message}`);
    return res.json({ error: 'update failed', details: e.message }, 500);
  }
};
