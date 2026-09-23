import { Client, Databases } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  // 1. Инициализация клиента Appwrite от лица сервера
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  try {
    // 2. Получение данных из тела запроса (body)
    // В Appwrite body передается как строка, если мы отправляем JSON
    let payload = {};
    if (req.body) {
      payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }

    const { databaseId, collectionId, documentId } = payload;

    if (!databaseId || !collectionId || !documentId) {
      error("Missing required parameters");
      return res.json({ error: "databaseId, collectionId, and documentId are required" }, 400);
    }

    // 3. Чтение документа из базы
    const document = await databases.getDocument(
      databaseId,
      collectionId,
      documentId
    );

    log(`Document ${documentId} fetched successfully`);

    // 4. Возвращаем документ на фронтенд
    return res.json({
      success: true,
      document: document
    });

  } catch (err) {
    error(`Error fetching document: ${err.message}`);
    return res.json({ 
      success: false, 
      error: err.message 
    }, 500);
  }
};
