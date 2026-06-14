import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
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

  const dogId = metadata['dogId'] as string;

  const [messagesResult, dogResult, ownerResult] = await Promise.all([
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
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'PROFILE' } })),
  ]);

  const dog = dogResult.Item ?? null;
  const owner = ownerResult.Item ?? null;
  const rawMessages = messagesResult.Items ?? [];

  // Ask-a-Vet is a group chat: several vets may have replied. Resolve every vet
  // who sent a message on this page so each message can be labelled with its
  // author, and expose the set of participating vets.
  const vetIds = [
    ...new Set(
      rawMessages
        .filter((m) => m['senderType'] === 'vet' && m['senderId'])
        .map((m) => m['senderId'] as string),
    ),
  ];
  const vetMap: Record<string, Record<string, unknown>> = {};
  if (vetIds.length > 0) {
    const batch = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [table]: { Keys: vetIds.map((id) => ({ PK: `VET#${id}`, SK: 'PROFILE' })) },
        },
      }),
    );
    for (const v of batch.Responses?.[table] ?? []) {
      vetMap[v['vetId'] as string] = v;
    }
  }

  const messages = rawMessages.map((m) => {
    const vet = m['senderType'] === 'vet' ? vetMap[m['senderId'] as string] : undefined;
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

  const vets = vetIds
    .map((id) => vetMap[id])
    .filter((v): v is Record<string, unknown> => v != null)
    .map((v) => ({
      vetId: v['vetId'],
      firstName: v['firstName'],
      lastName: v['lastName'],
      providerType: v['providerType'],
      specialisation: v['specialisation'] ?? null,
      photoUrl: v['photoUrl'] ?? null,
    }));

  return success({
    threadId,
    type: metadata['type'],
    status: metadata['status'],
    vets,
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
