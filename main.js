const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Client, Databases, Permission, Role, Query } = require('node-appwrite');

module.exports = async ({ req, res, log, error }) => {
  log(`end=${process.env.APPWRITE_FUNCTION_API_ENDPOINT}`);
  log(`pr=${process.env.APPWRITE_FUNCTION_PROJECT_ID}`);
  log(`hasKey=${!!process.env.APPWRITE_API_KEY}`);

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
  log(`graphId: ${graphId}`);
  
  try {
    const response = await databases.listDocuments(
        databaseId,
        collectionId,
        [Query.equal('$id', graphId), Query.limit(1)]
    );
    
    if (response.documents.length === 0) {
        return res.json({ error: 'graph not found' }, 404);
    }
    doc = response.documents[0];
    log(`doc found: ${doc.$id}`);
  } catch (e) {
    // В случае ошибки, сама ошибка будет выведена во вкладку "Errors" в консоли
    error(`listDocuments failed: ${e.message}`);
    return res.json({ error: 'database error on read' }, 500);
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
    log(`Successfully updated doc: ${updated.$id}`);
    return res.json({ success: true, document: updated });
  } catch (e) {
    error(`updateDocument failed: ${e.message}`);
    return res.json({ error: 'update failed' }, 500);
  }
};
