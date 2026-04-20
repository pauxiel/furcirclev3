import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const threadId = event.pathParameters?.['threadId'];

  if (!threadId) return error('INVALID_REQUEST', 'threadId is required', 400);

  const { Item: metadata } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' } }),
  );

  if (!metadata) return error('NOT_FOUND', 'Thread not found', 404);
  if (metadata['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);

  const msgResult = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `THREAD#${threadId}`, ':prefix': 'MSG#' },
    }),
  );

  const unread = (msgResult.Items ?? []).filter(
    (m) => m['senderType'] === 'owner' && m['readAt'] == null,
  );

  if (unread.length === 0) return success({ threadId, markedRead: 0 });

  const now = new Date().toISOString();
  await Promise.all(
    unread.map((m) =>
      docClient.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `THREAD#${threadId}`, SK: m['SK'] as string },
          UpdateExpression: 'SET readAt = :now',
          ExpressionAttributeValues: { ':now': now },
        }),
      ),
    ),
  );

  return success({ threadId, markedRead: unread.length });
};
