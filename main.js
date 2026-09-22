const { Client, Databases, Permission, Role, Query } = require('node-appwrite');
console.log(`endpoint=${process.env.APPWRITE_FUNCTION_API_ENDPOINT}`);
console.log(`project=${process.env.APPWRITE_FUNCTION_PROJECT_ID}`);
console.log(`hasKey=${!!process.env.APPWRITE_API_KEY}`);
module.exports = async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('69baae7d0010fa0c541d')
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
  try {
    // doc = await databases.getDocument(databaseId, collectionId, graphId);
    const doc = await databases.listDocuments(
        databaseId,
        collectionId,
        [Query.equal('$id', id), Query.limit(1)],
    );
    console.log('doc',doc);
  } catch (e) {
    error(`getDocument failed: ${e.message}`);
    return res.json({ error: 'graph not found' }, 404);
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
    return res.json({ success: true, document: updated });
  } catch (e) {
    error(`updateDocument failed: ${e.message}`);
    return res.json({ error: 'update failed' }, 500);
  }
};
