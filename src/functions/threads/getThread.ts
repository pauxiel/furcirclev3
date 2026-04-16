import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { encodeCursor, decodeCursor } from '../../lib/threads';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const threadId = event.pathParameters?.['threadId'];
  if (!threadId) return error('VALIDATION_ERROR', 'threadId required', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const params = event.queryStringParameters ?? {};
  const limit = parseInt(params['limit'] ?? '50', 10);
  const nextToken = params['nextToken'];

  const { Item: metadata } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' } }),
  );

  if (!metadata) return error('THREAD_NOT_FOUND', 'Thread not found', 404);
  if (metadata['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const vetId = metadata['vetId'] as string;
  const dogId = metadata['dogId'] as string;

  const [messagesResult, vetResult, dogResult, ownerResult] = await Promise.all([
    docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `THREAD#${threadId}`,
          ':prefix': 'MSG#',
        },
        ScanIndexForward: true,
        Limit: limit,
        ExclusiveStartKey: nextToken ? decodeCursor(nextToken) : undefined,
      }),
    ),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'PROFILE' } })),
  ]);

  const vet = vetResult.Item ?? null;
  const dog = dogResult.Item ?? null;
  const owner = ownerResult.Item ?? null;
  const rawMessages = messagesResult.Items ?? [];

  const messages = rawMessages.map((m) => {
    const senderName =
      m['senderType'] === 'vet'
        ? `Dr. ${vet?.['firstName'] ?? ''} ${vet?.['lastName'] ?? ''}`.trim()
        : (owner?.['firstName'] as string | undefined) ?? '';

    return {
      messageId: m['messageId'],
      senderId: m['senderId'],
      senderType: m['senderType'],
      senderName,
      body: m['body'],
      readAt: m['readAt'],
      createdAt: m['createdAt'],
    };
  });

  return success({
    threadId,
    type: metadata['type'],
    status: metadata['status'],
    vet: vet
      ? {
          vetId: vet['vetId'],
          firstName: vet['firstName'],
          lastName: vet['lastName'],
          providerType: vet['providerType'],
          specialisation: vet['specialisation'] ?? null,
          photoUrl: vet['photoUrl'] ?? null,
        }
      : null,
    dog: dog
      ? { dogId: dog['dogId'], name: dog['name'], breed: dog['breed'], ageMonths: dog['ageMonths'] }
      : null,
    dogProfileVisible: true,
    messages,
    nextToken: messagesResult.LastEvaluatedKey
      ? encodeCursor(messagesResult.LastEvaluatedKey as Record<string, unknown>)
      : null,
    createdAt: metadata['createdAt'],
    closedAt: metadata['closedAt'] ?? null,
  });
};
