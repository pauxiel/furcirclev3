import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { chunkArray } from '../../lib/threads';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const threadId = event.pathParameters?.['threadId'];
  if (!threadId) return error('VALIDATION_ERROR', 'threadId required', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const { Item: metadata } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' } }),
  );

  if (!metadata) return error('THREAD_NOT_FOUND', 'Thread not found', 404);
  if (metadata['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  // Paginated query — collect ALL messages
  const allMessages: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `THREAD#${threadId}`,
          ':prefix': 'MSG#',
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const msg of result.Items ?? []) {
      allMessages.push(msg);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  const unread = allMessages.filter(
    (m) => m['senderType'] === 'vet' && m['readAt'] == null,
  );

  if (unread.length === 0) {
    return success({ threadId, markedRead: 0 });
  }

  const now = new Date().toISOString();
  const chunks = chunkArray(unread, 25);

  await Promise.all(
    chunks.flatMap((chunk) =>
      chunk.map((msg) =>
        docClient.send(
          new UpdateCommand({
            TableName: table,
            Key: { PK: `THREAD#${threadId}`, SK: msg['SK'] as string },
            UpdateExpression: 'SET readAt = :readAt',
            ExpressionAttributeValues: { ':readAt': now },
          }),
        ),
      ),
    ),
  );

  return success({ threadId, markedRead: unread.length });
};
