import https from 'https';
import http from 'http';
import dns from 'dns';
import { Client, Databases } from 'node-appwrite';

dns.setDefaultResultOrder('ipv4first');

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

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  try {
    let payload = {};
    if (req.body) {
      payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }

    const { databaseId, collectionId, documentId } = payload;

    if (!databaseId || !collectionId || !documentId) {
      error("Missing required parameters");
      return res.json({ error: "databaseId, collectionId, and documentId are required" }, 400);
    }

    const document = await databases.getDocument(databaseId, collectionId, documentId);

    log(`Document ${documentId} fetched successfully`);

    return res.json({ success: true, document });

  } catch (err) {
    error(`Error fetching document: ${err.message}`);
    return res.json({ success: false, error: err.message }, 500);
  }
};
