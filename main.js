// Возвращаем фикс для IPv6, чтобы встроенный fetch работал корректно
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, Databases, Permission, Role, Query } = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  log(`--- EXECUTING GRAPH COLLABORATORS UPDATE ---`);
  
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://cloud.appwrite.io/v1';
  
  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

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

  const { databaseId, collectionId, graphId, collaborators } = body;

  if (!databaseId || !collectionId || !graphId || !collaborators) {
    return res.json({ error: 'missing fields' }, 400);
  }

  let doc;
  log(`Searching for graphId: ${graphId}`);
  
  try {
    const response = await databases.listDocuments(
        databaseId,
        collectionId,
        [Query.equal('$id', graphId), Query.limit(1)]
    );
    
    if (response.documents.length === 0) {
        log('Graph not found in database');
        return res.json({ error: 'graph not found' }, 404);
    }
    doc = response.documents[0];
    log(`Success! Graph doc found: ${doc.$id}`);
  } catch (e) {
    log(`CRITICAL ERROR ON READ: ${e.message}`);
    error(`Database read error: ${e.message}`);
    return res.json({ error: 'database error on read', details: e.message }, 500);
  }

  if (doc.owner !== callerUserId) {
    return res.json({ error: 'forbidden: only owner can manage collaborators' }, 403);
  }

  const permissions = [
    Permission.read(Role.any()),
    Permission.update(Role.user(doc.owner)),
    Permission.delete(Role.user(doc.owner)),
  ];

  Object.entries(collaborators).forEach(([userId, role]) => {
    if (userId === doc.owner) return;
    if (role === 'editor') {
      permissions.push(Permission.update(Role.user(userId)));
    }
  });

  try {
    const updated = await databases.updateDocument(
      databaseId,
      collectionId,
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
