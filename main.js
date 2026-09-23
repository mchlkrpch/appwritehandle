import { Client, TablesDB } from 'node-appwrite';
// ... polyfill fetch как раньше ...

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const tablesDB = new TablesDB(client);

  try {
    let payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { databaseId, tableId, rowId } = payload; // rowId вместо documentId

    const row = await tablesDB.getRow(databaseId, tableId, rowId);

    log(`Row ${rowId} fetched successfully`);
    return res.json({ success: true, document: row });

  } catch (err) {
    error(`Error fetching row: ${err.message}`);
    return res.json({ success: false, error: err.message }, 500);
  }
};
